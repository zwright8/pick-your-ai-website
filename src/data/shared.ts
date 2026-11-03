import type {
  BuildSnapshot,
  CatalogItem,
  CatalogSnapshot,
  ComponentKind,
  Provenance,
  Ruleset,
} from '../contracts';
import { addOrReplace, removeSelection, replaceSelection } from '../domain/build';
import { evaluateBuild } from '../domain/evaluator';
import { itemFreshness } from '../domain/freshness';
import type { CompatibleOption, EvidenceProvider, ItemEvidence } from './types';

/** Hide a record from local rule evaluation if an enabled selection pins another kind or version. */
export function catalogForBuildEvidence(
  build: BuildSnapshot,
  snapshot: CatalogSnapshot,
): CatalogSnapshot {
  const byId = new Map(snapshot.items.map((item) => [item.id, item]));
  const unavailable = new Set(
    build.selections.flatMap((selection) => {
      if (!selection.enabled) return [];
      const item = byId.get(selection.catalog_item_id);
      return item &&
        (item.kind !== selection.kind || item.version !== selection.catalog_item_version)
        ? [selection.catalog_item_id]
        : [];
    }),
  );
  return unavailable.size
    ? { ...snapshot, items: snapshot.items.filter((item) => !unavailable.has(item.id)) }
    : snapshot;
}

const RANK: Record<Provenance['verification_status'], number> = {
  unverified: 0,
  estimated: 1,
  user_supplied: 2,
  verified: 3,
};

/** Evidence is derived from catalog provenance; no separate evidence endpoint exists in v1. */
export class ProvenanceEvidenceProvider implements EvidenceProvider {
  async forItem(item: CatalogItem): Promise<ItemEvidence> {
    const best = [...item.provenance].sort(
      (a, b) => RANK[b.verification_status] - RANK[a.verification_status],
    )[0]!;
    return {
      itemId: item.id,
      itemVersion: item.version,
      provenance: item.provenance,
      verification: best.verification_status,
      freshness: itemFreshness(item),
      synthetic: (item.tags ?? []).includes('synthetic'),
    };
  }
}

const OUTCOME_RANK: Record<string, number> = { pass: 0, skipped: 0, unknown: 1, fail: 2 };

/**
 * Evaluates each alternative by substituting it into the build (same selection id and role) and
 * running the published ruleset. A failure counts against a candidate only when the candidate makes
 * that rule's outcome worse than it is with the slot left empty, so a rule that already fails for an
 * unfinished build (e.g. `rule.required.foundation` before T0/T1 are chosen) does not mark every
 * option incompatible. An unresolved relevant rule remains unknown even when the empty slot is
 * also unknown. Verdict: any attributable fail → incompatible; any remaining unknown → unknown;
 * otherwise compatible (with the current picks and evidence only).
 */
export function compatibleOptionsLocal(
  build: BuildSnapshot,
  snapshot: CatalogSnapshot,
  ruleset: Ruleset,
  kind: ComponentKind,
  role: string,
): CompatibleOption[] {
  const candidates = snapshot.items.filter((i) => i.kind === kind);
  const existing = build.selections.find((s) => s.kind === kind && s.role === role);
  const relevant = ruleset.rules.filter((r) => (r.affected_kinds as string[]).includes(kind));
  const byId = new Map(snapshot.items.map((i) => [i.id, i]));
  const scoped = { ...ruleset, rules: relevant };
  // Evidence is tied to the current revision; hypothetical builds must not reuse it.
  const evaluate = (b: BuildSnapshot) =>
    evaluateBuild({
      build: b,
      catalog: catalogForBuildEvidence(b, snapshot),
      ruleset: scoped,
      resourceEstimate: null,
      costEstimate: null,
    });
  const worst = (findings: ReturnType<typeof evaluate>['findings']) => {
    const m = new Map<string, number>();
    for (const f of findings)
      m.set(f.rule_id, Math.max(m.get(f.rule_id) ?? 0, OUTCOME_RANK[f.outcome] ?? 0));
    return m;
  };
  const baseline = worst(evaluate(existing ? removeSelection(build, existing.id) : build).findings);
  return candidates.map((item) => {
    const hypothetical = existing
      ? replaceSelection(build, existing.id, item, byId)
      : addOrReplace(build, item, byId, { additional: true });
    const findings = evaluate(hypothetical).findings;
    const outcomes = [...worst(findings)];
    const fails = outcomes
      .filter(([id, rank]) => rank === OUTCOME_RANK.fail && rank > (baseline.get(id) ?? 0))
      .map(([id]) => id);
    const unknowns = [
      ...new Set(findings.filter((f) => f.outcome === 'unknown').map((f) => f.rule_id)),
    ];
    return {
      catalog_item_id: item.id,
      catalog_item_version: item.version,
      verdict: fails.length ? 'incompatible' : unknowns.length ? 'unknown' : 'compatible',
      rule_ids: fails.length ? fails : unknowns,
    };
  });
}
