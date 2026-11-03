/* Candidate ranking must attribute only the findings a candidate introduces. */
import { describe, expect, it } from 'vitest';
import { BASELINE_RULESET } from '../../src/contracts';
import { addOrReplace, createBuild } from '../../src/domain/build';
import { createFixtureProviders } from '../../src/data/fixture/providers';
import { catalogForBuildEvidence, compatibleOptionsLocal } from '../../src/data/shared';
import {
  BY_ID,
  CATALOG,
  NOW,
  apiChat,
  buildWith,
  contradictory,
  item,
  resourceEstimate,
  selfHosted,
} from './scenarios';

const options = (build: Parameters<typeof compatibleOptionsLocal>[0], kind: string) =>
  compatibleOptionsLocal(build, CATALOG, BASELINE_RULESET, kind as never, 'primary');

describe('compatible options', () => {
  it('withholds an ID shared by conflicting active pins without altering the source catalog', () => {
    const model = item('model', 'aurora-large');
    const build = addOrReplace(apiChat(), model, BY_ID, { additional: true });
    const stale = {
      ...build,
      selections: build.selections.map((selection) =>
        selection.id === 'sel_model'
          ? { ...selection, catalog_item_version: 'older-version' }
          : selection,
      ),
    };
    expect(
      catalogForBuildEvidence(stale, CATALOG).items.some((entry) => entry.id === model.id),
    ).toBe(false);
    expect(CATALOG.items.some((entry) => entry.id === model.id)).toBe(true);
    const disabled = {
      ...stale,
      selections: stale.selections.map((selection) =>
        selection.id === 'sel_model' ? { ...selection, enabled: false } : selection,
      ),
    };
    expect(catalogForBuildEvidence(disabled, CATALOG)).toBe(CATALOG);
  });

  it('does not infer tool behavior from a different catalog version', async () => {
    const providers = createFixtureProviders({ now: () => NOW });
    const build = buildWith([['tool', 'search']], apiChat());
    const matched = await providers.compatibility.evaluate(build);
    expect(
      matched.findings.find((finding) => finding.rule_id === 'rule.tool.mutation.guardrails')
        ?.outcome,
    ).toBe('skipped');
    const stale = {
      ...build,
      selections: build.selections.map((selection) =>
        selection.kind === 'tool'
          ? { ...selection, catalog_item_version: 'older-version' }
          : selection,
      ),
    };
    const report = await providers.compatibility.evaluate(stale);
    expect(
      report.findings.find((finding) => finding.rule_id === 'rule.tool.mutation.guardrails')
        ?.outcome,
    ).toBe('unknown');
  });

  it('does not infer device capacity from a different catalog version', async () => {
    const providers = createFixtureProviders({ now: () => NOW });
    const build = selfHosted();
    const evidence = resourceEstimate(build, '20', 'calibrated');
    const matched = await providers.compatibility.evaluate(build, { resourceEstimate: evidence });
    expect(
      matched.findings.find((finding) => finding.rule_id === 'rule.vram.per.device.fit')?.outcome,
    ).toBe('pass');
    const stale = {
      ...build,
      selections: build.selections.map((selection) =>
        selection.kind === 'accelerator'
          ? { ...selection, catalog_item_version: 'older-version' }
          : selection,
      ),
    };
    const report = await providers.compatibility.evaluate(stale, { resourceEstimate: evidence });
    expect(
      report.findings.find((finding) => finding.rule_id === 'rule.vram.per.device.fit')?.outcome,
    ).toBe('unknown');
  });
  it('does not mark every workload incompatible on an empty build', () => {
    const empty = createBuild({ id: 'build.test.empty', catalogSnapshotId: CATALOG.id, now: NOW });
    const opts = options(empty, 'workload');
    expect(opts.length).toBeGreaterThan(0);
    // Only the restricted-data workload introduces its own failing rule (redaction monitoring).
    const incompatible = opts.filter((o) => o.verdict === 'incompatible');
    expect(incompatible.map((o) => o.catalog_item_id)).toEqual([
      item('workload', 'restricted-assistant').id,
    ]);
    expect(opts.flatMap((o) => o.rule_ids)).not.toContain('rule.required.foundation');
  });

  it('does not blame candidates for a foundation rule that fails either way', () => {
    const partial = buildWith([['workload', 'support-chat']]);
    for (const o of options(partial, 'deployment_mode'))
      expect(o.rule_ids).not.toContain('rule.required.foundation');
  });

  it('still reports a contradiction the candidate introduces', () => {
    const verdicts = new Map(options(contradictory(), 'model').map((o) => [o.catalog_item_id, o]));
    const weightsOnly = verdicts.get(item('model', 'open-8b').id)!;
    expect(weightsOnly.verdict).toBe('incompatible');
    expect(weightsOnly.rule_ids.length).toBeGreaterThan(0);
    expect(verdicts.get(item('model', 'aurora-large').id)!.verdict).not.toBe('incompatible');
  });
});
