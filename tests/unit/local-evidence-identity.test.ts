import { describe, expect, it } from 'vitest';
import { assertContract } from '../../src/contracts';
import { createFixtureProviders } from '../../src/data/fixture/providers';
import { updateObjectives } from '../../src/domain/build';
import { apiChat, buildWith, NOW, resourceEstimate, selfHosted } from './scenarios';

describe('local build artifact locks', () => {
  it('does not price or evaluate a build using a different catalog snapshot', async () => {
    const providers = createFixtureProviders({ now: () => NOW });
    const build = apiChat();
    build.locks.catalog_snapshot_id = 'catalog.foreign';
    assertContract('BuildSnapshot', build);
    await expect(providers.pricing.estimate(build)).rejects.toMatchObject({ kind: 'not_found' });
    await expect(providers.compatibility.evaluate(build)).rejects.toMatchObject({
      kind: 'not_found',
    });
    await expect(providers.compatibility.compatibleOptions(build, 'model')).rejects.toMatchObject({
      kind: 'not_found',
    });
  });

  it.each([
    'ruleset_id',
    'ruleset_version',
    'dependency_graph_id',
    'dependency_graph_revision',
  ] as const)('does not evaluate against a different %s', async (field) => {
    const providers = createFixtureProviders({ now: () => NOW });
    const build = apiChat();
    if (field === 'ruleset_id') build.locks.ruleset_id = 'ruleset.foreign';
    if (field === 'ruleset_version') build.locks.ruleset_version = '9.0.0';
    if (field === 'dependency_graph_id') build.locks.dependency_graph_id = 'graph.foreign';
    if (field === 'dependency_graph_revision') build.locks.dependency_graph_revision += 1;
    assertContract('BuildSnapshot', build);
    await expect(providers.compatibility.evaluate(build)).rejects.toMatchObject({
      kind: 'not_found',
    });
    await expect(providers.compatibility.compatibleOptions(build, 'model')).rejects.toMatchObject({
      kind: 'not_found',
    });
  });
});

describe('local evaluation dispatch context', () => {
  it('prices and evaluates the build as it was when requested', async () => {
    const providers = createFixtureProviders({ now: () => NOW, latencyMs: 20 });
    const build = apiChat();
    const original = structuredClone(build);
    const price = providers.pricing.estimate(build);
    const report = providers.compatibility.evaluate(build);
    build.id = 'build.changed';
    build.revision += 1;
    build.locks.catalog_snapshot_id = 'catalog.changed';
    const [priced, evaluated] = await Promise.all([price, report]);
    expect(priced).toMatchObject({ build_id: original.id, build_revision: original.revision });
    expect(evaluated).toMatchObject({
      build_id: original.id,
      build_revision: original.revision,
      catalog_snapshot_id: original.locks.catalog_snapshot_id,
    });
  });

  it('uses the resource evidence captured at dispatch', async () => {
    const build = selfHosted();
    const resources = resourceEstimate(build, '20', 'calibrated');
    const baseline = await createFixtureProviders({ now: () => NOW }).compatibility.evaluate(
      build,
      {
        resourceEstimate: structuredClone(resources),
      },
    );
    const providers = createFixtureProviders({ now: () => NOW, latencyMs: 20 });
    const pending = providers.compatibility.evaluate(build, { resourceEstimate: resources });
    resources.build_id = 'build.changed';
    const report = await pending;
    expect(report.findings.find((f) => f.rule_id === 'rule.vram.estimate.fit')?.outcome).toBe(
      baseline.findings.find((f) => f.rule_id === 'rule.vram.estimate.fit')?.outcome,
    );
    expect(baseline.findings.find((f) => f.rule_id === 'rule.vram.estimate.fit')?.outcome).toBe(
      'pass',
    );
  });

  it('uses cost evidence captured at dispatch', async () => {
    const build = updateObjectives(buildWith([['cost_policy', 'hard-cap']], apiChat()), {
      monthly_budget_amount: '10000.00',
    });
    const fixture = createFixtureProviders({ now: () => NOW });
    const cost = await fixture.pricing.estimate(build);
    const pending = createFixtureProviders({
      now: () => NOW,
      latencyMs: 20,
    }).compatibility.evaluate(build, { costEstimate: cost });
    cost.build_id = 'build.changed';
    const report = await pending;
    expect(report.findings.find((f) => f.rule_id === 'rule.budget.monthly.cap')?.outcome).toBe(
      'pass',
    );
  });

  it('evaluates candidate options against the build captured at dispatch', async () => {
    const build = apiChat();
    const original = structuredClone(build);
    const expected = await createFixtureProviders({
      now: () => NOW,
    }).compatibility.compatibleOptions(original, 'model');
    const pending = createFixtureProviders({
      now: () => NOW,
      latencyMs: 20,
    }).compatibility.compatibleOptions(build, 'model');
    build.locks.catalog_snapshot_id = 'catalog.changed';
    build.revision += 1;
    expect(await pending).toEqual(expected);
  });
});
