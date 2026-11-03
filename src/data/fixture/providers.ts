/*
 * Fixture providers: synthetic, schema-validated data served in-browser. They exercise the same
 * interfaces and validation paths as the HTTP providers, with a small simulated latency so loading
 * states are real.
 */
import type {
  BuildSnapshot,
  CatalogSnapshot,
  ComponentKind,
  CostEstimate,
  DependencyGraph,
  EvaluationReport,
  Pricebook,
  Ruleset,
} from '../../contracts';
import { BASELINE_GRAPH, BASELINE_RULESET, assertContract, validatorsReady } from '../../contracts';
import { estimateCost } from '../../domain/cost';
import { evaluateBuild } from '../../domain/evaluator';
import { DataError } from '../errors';
import { hasConsistentCostCurrency } from '../cost-evidence';
import {
  hasConsistentResourceUnits,
  hasKnownResourceSelections,
  matchesBuildEvidence,
  matchesCostEvidence,
} from '../evidence-context';
import { LocalBuildRepository } from '../local-builds';
import {
  ProvenanceEvidenceProvider,
  catalogForBuildEvidence,
  compatibleOptionsLocal,
} from '../shared';
import type {
  CatalogRepository,
  CompatibilityEvaluator,
  CompatibleOption,
  DataProviders,
  EvaluationEvidence,
  PricingProvider,
  ResourceEstimateProvider,
  ResourceEstimateResult,
} from '../types';
import { DEMO_CATALOG } from './catalog';
import { DEMO_PRICEBOOK } from './pricebook';

export interface FixtureOptions {
  catalog?: CatalogSnapshot;
  pricebook?: Pricebook;
  graph?: DependencyGraph;
  ruleset?: Ruleset;
  latencyMs?: number;
  now?: () => string;
}

const delay = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

export class FixtureCatalogRepository implements CatalogRepository {
  private readonly data: Promise<{
    snapshot: CatalogSnapshot;
    graph: DependencyGraph;
    ruleset: Ruleset;
  }>;
  private readonly latency: number;
  constructor(opts: FixtureOptions = {}) {
    // Validate fixtures exactly as live responses would be validated.
    this.data = validatorsReady.then(() => ({
      snapshot: assertContract('CatalogSnapshot', opts.catalog ?? DEMO_CATALOG),
      graph: assertContract('DependencyGraph', opts.graph ?? BASELINE_GRAPH),
      ruleset: assertContract('Ruleset', opts.ruleset ?? BASELINE_RULESET),
    }));
    // Consumers still await the original rejected promise; observe early failures until they do.
    void this.data.catch(() => undefined);
    this.latency = opts.latencyMs ?? 0;
  }
  async getSnapshot(snapshotId?: string) {
    await delay(this.latency);
    const { snapshot } = await this.data;
    if (snapshotId && snapshotId !== snapshot.id) {
      throw new DataError('not_found', `Catalog snapshot ${snapshotId} is not available.`);
    }
    return snapshot;
  }
  async listItems(kind?: ComponentKind) {
    const s = await this.getSnapshot();
    return kind ? s.items.filter((i) => i.kind === kind) : s.items;
  }
  async getItem(id: string) {
    const item = (await this.getSnapshot()).items.find((i) => i.id === id);
    if (!item) throw new DataError('not_found', `Catalog item ${id} not found.`);
    return item;
  }
  async getDependencyGraph() {
    await delay(this.latency);
    return (await this.data).graph;
  }
  async getRuleset() {
    await delay(this.latency);
    return (await this.data).ruleset;
  }
}

export class LocalCompatibilityEvaluator implements CompatibilityEvaluator {
  private readonly catalog: CatalogRepository;
  private readonly now: () => string;
  constructor(catalog: CatalogRepository, now: () => string = () => new Date().toISOString()) {
    this.catalog = catalog;
    this.now = now;
  }
  private async pinnedArtifacts(build: BuildSnapshot) {
    const [snapshot, ruleset, graph] = await Promise.all([
      this.catalog.getSnapshot(build.locks.catalog_snapshot_id),
      this.catalog.getRuleset(),
      this.catalog.getDependencyGraph(),
    ]);
    if (snapshot.id !== build.locks.catalog_snapshot_id)
      throw new DataError('not_found', 'The pinned catalog snapshot is unavailable.');
    if (ruleset.id !== build.locks.ruleset_id || ruleset.version !== build.locks.ruleset_version)
      throw new DataError('not_found', 'The pinned ruleset is unavailable.');
    if (
      graph.id !== build.locks.dependency_graph_id ||
      graph.revision !== build.locks.dependency_graph_revision
    )
      throw new DataError('not_found', 'The pinned dependency graph is unavailable.');
    return { snapshot, ruleset };
  }
  async evaluate(
    build: BuildSnapshot,
    evidence: EvaluationEvidence = {},
  ): Promise<EvaluationReport> {
    const submitted = structuredClone(build);
    const submittedEvidence = structuredClone(evidence);
    const { snapshot, ruleset } = await this.pinnedArtifacts(submitted);
    const report = evaluateBuild({
      build: submitted,
      catalog: catalogForBuildEvidence(submitted, snapshot),
      ruleset,
      resourceEstimate:
        submittedEvidence.resourceEstimate &&
        matchesBuildEvidence(submitted, submittedEvidence.resourceEstimate) &&
        hasConsistentResourceUnits(submittedEvidence.resourceEstimate) &&
        hasKnownResourceSelections(
          submittedEvidence.resourceEstimate,
          new Set(submitted.selections.map((selection) => selection.id)),
        )
          ? submittedEvidence.resourceEstimate
          : null,
      costEstimate:
        submittedEvidence.costEstimate &&
        matchesCostEvidence(submitted, submittedEvidence.costEstimate) &&
        hasConsistentCostCurrency(submittedEvidence.costEstimate)
          ? submittedEvidence.costEstimate
          : null,
      evaluatedAt: this.now(),
    });
    return assertContract('EvaluationReport', report);
  }
  async compatibleOptions(
    build: BuildSnapshot,
    kind: ComponentKind,
    role = 'primary',
  ): Promise<CompatibleOption[]> {
    const submitted = structuredClone(build);
    const { snapshot, ruleset } = await this.pinnedArtifacts(submitted);
    return compatibleOptionsLocal(submitted, snapshot, ruleset, kind, role);
  }
}

export class FixturePricingProvider implements PricingProvider {
  private readonly catalog: CatalogRepository;
  private readonly pricebook: Promise<Pricebook>;
  private readonly now: () => string;
  constructor(catalog: CatalogRepository, opts: FixtureOptions = {}) {
    this.catalog = catalog;
    this.pricebook = validatorsReady.then(() =>
      assertContract('Pricebook', opts.pricebook ?? DEMO_PRICEBOOK),
    );
    // Consumers still await the original rejected promise; observe early failures until they do.
    void this.pricebook.catch(() => undefined);
    this.now = opts.now ?? (() => new Date().toISOString());
  }
  async getPricebook(pricebookId?: string) {
    const pricebook = await this.pricebook;
    if (pricebookId && pricebookId !== pricebook.id) {
      throw new DataError('not_found', `Pricebook ${pricebookId} is not available.`);
    }
    return pricebook;
  }
  async estimate(build: BuildSnapshot, periodDays = 30): Promise<CostEstimate> {
    const submitted = structuredClone(build);
    const snapshot = await this.catalog.getSnapshot(submitted.locks.catalog_snapshot_id);
    if (snapshot.id !== submitted.locks.catalog_snapshot_id)
      throw new DataError('not_found', 'The pinned catalog snapshot is unavailable.');
    const pricebook = await this.getPricebook(submitted.locks.pricebook_id);
    const estimate = estimateCost(
      submitted,
      new Map(snapshot.items.map((i) => [i.id, i])),
      pricebook,
      { periodDays, now: this.now() },
    );
    return assertContract('CostEstimate', estimate);
  }
}

/** No capacity estimator exists yet; the honest answer is "no evidence" (rules report Unknown). */
export class UnavailableResourceEstimateProvider implements ResourceEstimateProvider {
  async estimate(): Promise<ResourceEstimateResult> {
    return {
      status: 'unavailable',
      reason:
        'No calibrated capacity estimator is connected. Memory-fit rules stay Unknown rather than being guessed from model size.',
    };
  }
}

export function createFixtureProviders(opts: FixtureOptions = {}): DataProviders {
  const catalog = new FixtureCatalogRepository(opts);
  return {
    mode: 'fixture',
    buildStore: 'local',
    catalog,
    builds: new LocalBuildRepository(),
    compatibility: new LocalCompatibilityEvaluator(catalog, opts.now),
    pricing: new FixturePricingProvider(catalog, opts),
    evidence: new ProvenanceEvidenceProvider(),
    resources: new UnavailableResourceEstimateProvider(),
  };
}
