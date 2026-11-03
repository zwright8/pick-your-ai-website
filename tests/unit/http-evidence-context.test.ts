import { describe, expect, it, vi } from 'vitest';
import { assertContract, type BuildSnapshot } from '../../src/contracts';
import { createFixtureProviders } from '../../src/data/fixture/providers';
import { DEMO_PRICEBOOK } from '../../src/data/fixture/pricebook';
import type { FetchLike } from '../../src/data/http/client';
import { createHttpProviders } from '../../src/data/http/providers';
import { updateObjectives } from '../../src/domain/build';
import { CATALOG, NOW, apiChat, buildWith, resourceEstimate, selfHosted } from './scenarios';

const fixture = createFixtureProviders({ now: () => NOW });
const json = (value: unknown) =>
  new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
const responseApi = (value: unknown, duringRequest?: () => void) =>
  vi.fn<FetchLike>(async () => {
    duringRequest?.();
    return json(value);
  });
const providers = (fetch: FetchLike, pricebookId: string | undefined = DEMO_PRICEBOOK.id) =>
  createHttpProviders({
    baseUrl: 'https://api.test/v1',
    catalogSnapshotId: CATALOG.id,
    pricebookId,
    fetch,
  });
function pinnedBuild() {
  const build = apiChat();
  build.locks.pricebook_id = DEMO_PRICEBOOK.id;
  return assertContract('BuildSnapshot', build);
}

describe('HTTP evaluation response context', () => {
  it.each([
    ['a nonexistent selection', ['sel_nonexistent']],
    ['no selections', []],
  ] as const)('does not send resource evidence tied to %s', async (_label, selectionIds) => {
    const build = selfHosted();
    const resource = resourceEstimate(build, '20', 'calibrated');
    resource.estimates = resource.estimates.map((entry) => ({
      ...entry,
      selection_ids: [...selectionIds],
    }));
    if (selectionIds.length) assertContract('ResourceEstimate', resource);
    const api = responseApi(await fixture.compatibility.evaluate(build));
    await expect(
      providers(api).compatibility.evaluate(build, { resourceEstimate: resource }),
    ).rejects.toMatchObject({ kind: 'malformed', contract: 'ResourceEstimate' });
    expect(api).not.toHaveBeenCalled();
  });

  it('does not send an empty resource document', async () => {
    const build = selfHosted();
    const resource = resourceEstimate(build, '20', 'calibrated');
    resource.estimates = [];
    const api = responseApi(await fixture.compatibility.evaluate(build));
    await expect(
      providers(api).compatibility.evaluate(build, { resourceEstimate: resource }),
    ).rejects.toMatchObject({ kind: 'malformed', contract: 'ResourceEstimate' });
    expect(api).not.toHaveBeenCalled();
  });

  it('accepts resource metrics paired with their corresponding units', async () => {
    const build = pinnedBuild();
    const resource = resourceEstimate(build, '20', 'calibrated');
    const first = resource.estimates[0];
    if (!first) throw new Error('Missing resource fixture');
    resource.estimates = [
      { ...first, metric: 'inference.estimated_required_vram_gb', unit: 'gb' },
      { ...first, metric: 'inference.estimated_peak_per_device_vram_gb', unit: 'gb' },
      { ...first, metric: 'inference.estimated_tokens_per_second', unit: 'tokens_per_second' },
      { ...first, metric: 'compute.estimated_gpu_power_w', unit: 'watt' },
      { ...first, metric: 'training.estimated_gpu_hours', unit: 'gpu_hour' },
    ];
    assertContract('ResourceEstimate', resource);
    const report = await fixture.compatibility.evaluate(build);
    const api = responseApi(report);
    await expect(
      providers(api).compatibility.evaluate(build, { resourceEstimate: resource }),
    ).resolves.toEqual(report);
    expect(api).toHaveBeenCalledOnce();
  });

  it.each([
    ['inference.estimated_required_vram_gb', 'watt'],
    ['inference.estimated_peak_per_device_vram_gb', 'watt'],
    ['inference.estimated_tokens_per_second', 'gb'],
    ['compute.estimated_gpu_power_w', 'gpu_hour'],
    ['training.estimated_gpu_hours', 'watt'],
  ] as const)('does not send %s evidence in the wrong unit', async (metric, unit) => {
    const build = pinnedBuild();
    const resource = resourceEstimate(build, '20', 'calibrated');
    const first = resource.estimates[0];
    if (!first) throw new Error('Missing resource fixture');
    resource.estimates = [{ ...first, metric, unit }];
    assertContract('ResourceEstimate', resource);
    const api = responseApi(await fixture.compatibility.evaluate(build));
    await expect(
      providers(api).compatibility.evaluate(build, { resourceEstimate: resource }),
    ).rejects.toMatchObject({ kind: 'malformed', contract: 'ResourceEstimate' });
    expect(api).not.toHaveBeenCalled();
  });

  it.each(['build_id', 'build_revision', 'pricebook_id'] as const)(
    'does not send cost evidence with a foreign %s',
    async (field) => {
      const build = pinnedBuild();
      const cost = await fixture.pricing.estimate(build);
      const foreign = assertContract('CostEstimate', {
        ...cost,
        [field]: field === 'build_revision' ? build.revision + 1 : 'foreign.artifact',
      });
      const api = responseApi(await fixture.compatibility.evaluate(build));
      await expect(
        providers(api).compatibility.evaluate(build, { costEstimate: foreign }),
      ).rejects.toMatchObject({ kind: 'malformed', contract: 'CostEstimate' });
      expect(api).not.toHaveBeenCalled();
    },
  );

  it.each(['build_id', 'build_revision'] as const)(
    'does not send resource evidence with a foreign %s',
    async (field) => {
      const build = pinnedBuild();
      const foreign = assertContract('ResourceEstimate', {
        ...resourceEstimate(build, '24', 'calibrated'),
        [field]: field === 'build_revision' ? build.revision + 1 : 'foreign.artifact',
      });
      const api = responseApi(await fixture.compatibility.evaluate(build));
      await expect(
        providers(api).compatibility.evaluate(build, { resourceEstimate: foreign }),
      ).rejects.toMatchObject({ kind: 'malformed', contract: 'ResourceEstimate' });
      expect(api).not.toHaveBeenCalled();
    },
  );

  it('rejects inconsistent cost evidence before sending it for evaluation', async () => {
    const build = pinnedBuild();
    const cost = await fixture.pricing.estimate(build);
    cost.total.currency = 'EUR';
    const api = responseApi({});
    await expect(
      providers(api).compatibility.evaluate(build, { costEstimate: cost }),
    ).rejects.toMatchObject({
      kind: 'malformed',
      contract: 'CostEstimate',
    });
    expect(api).not.toHaveBeenCalled();
  });

  const foreignLocks = {
    catalog_snapshot_id: 'catalog.foreign',
    ruleset_id: 'ruleset.foreign',
    ruleset_version: '9.0.0',
    dependency_graph_id: 'graph.foreign',
    dependency_graph_revision: 91,
  };

  it.each(Object.entries(foreignLocks))('rejects a schema-valid foreign %s', async (key, value) => {
    const build = pinnedBuild();
    const report = assertContract('EvaluationReport', {
      ...(await fixture.compatibility.evaluate(build)),
      [key]: value,
    });
    const api = responseApi(report);
    await expect(providers(api).compatibility.evaluate(build)).rejects.toMatchObject({
      kind: 'malformed',
      contract: 'EvaluationReport',
    });
    expect(api).toHaveBeenCalledExactlyOnceWith(
      `https://api.test/v1/builds/${build.id}/evaluate`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ build_revision: build.revision }),
      }),
    );
  });

  it('accepts exact pinned context and sends the selected evidence IDs', async () => {
    const build = pinnedBuild();
    const cost = await fixture.pricing.estimate(build);
    const resources = assertContract(
      'ResourceEstimate',
      resourceEstimate(build, '24', 'calibrated'),
    );
    const report = await fixture.compatibility.evaluate(build, {
      costEstimate: cost,
      resourceEstimate: resources,
    });
    const api = responseApi(report);
    await expect(
      providers(api).compatibility.evaluate(build, {
        costEstimate: cost,
        resourceEstimate: resources,
      }),
    ).resolves.toEqual(report);
    expect(api).toHaveBeenCalledExactlyOnceWith(
      `https://api.test/v1/builds/${build.id}/evaluate`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          build_revision: build.revision,
          resource_estimate_id: resources.id,
          cost_estimate_id: cost.id,
        }),
        headers: expect.objectContaining({ 'Idempotency-Key': expect.any(String) }),
      }),
    );
  });

  it('accepts exact pinned context when optional evidence is omitted or null', async () => {
    const build = pinnedBuild();
    const report = await fixture.compatibility.evaluate(build);
    for (const evidence of [undefined, { costEstimate: null, resourceEstimate: null }]) {
      const api = responseApi(report);
      await expect(providers(api).compatibility.evaluate(build, evidence)).resolves.toEqual(report);
      expect(api).toHaveBeenCalledExactlyOnceWith(
        `https://api.test/v1/builds/${build.id}/evaluate`,
        expect.objectContaining({ body: JSON.stringify({ build_revision: build.revision }) }),
      );
    }
  });

  it.each(['build_id', 'build_revision'] as const)(
    'continues rejecting foreign %s',
    async (field) => {
      const build = pinnedBuild();
      const report = assertContract('EvaluationReport', {
        ...(await fixture.compatibility.evaluate(build)),
        [field]: field === 'build_id' ? 'build.foreign' : build.revision + 1,
      });
      await expect(
        providers(responseApi(report)).compatibility.evaluate(build),
      ).rejects.toMatchObject({
        kind: 'malformed',
        contract: 'EvaluationReport',
      });
    },
  );

  it.each([false, true])(
    'binds evaluation to dispatch context when caller changes (foreign response: %s)',
    async (foreign) => {
      const build = pinnedBuild();
      const original = structuredClone(build);
      const report = await fixture.compatibility.evaluate(build);
      const changed = {
        build_id: 'build.changed',
        build_revision: build.revision + 1,
        ...foreignLocks,
      };
      const response = assertContract(
        'EvaluationReport',
        foreign ? { ...report, ...changed } : report,
      );
      const api = responseApi(response, () => {
        build.id = changed.build_id;
        build.revision = changed.build_revision;
        Object.assign(build.locks, foreignLocks);
      });
      const pending = providers(api).compatibility.evaluate(build);
      if (foreign) {
        await expect(pending).rejects.toMatchObject({
          kind: 'malformed',
          contract: 'EvaluationReport',
        });
      } else {
        await expect(pending).resolves.toEqual(report);
      }
      expect(api).toHaveBeenCalledExactlyOnceWith(
        `https://api.test/v1/builds/${original.id}/evaluate`,
        expect.objectContaining({ body: JSON.stringify({ build_revision: original.revision }) }),
      );
    },
  );
});

it('does not use inconsistent currency evidence for the local budget rule', async () => {
  const build = updateObjectives(buildWith([['cost_policy', 'hard-cap']], apiChat()), {
    monthly_budget_amount: '10000.00',
  });
  const cost = await fixture.pricing.estimate(build);
  expect(cost.coverage).toBe('complete');
  const valid = await fixture.compatibility.evaluate(build, { costEstimate: cost });
  expect(
    valid.findings.find((finding) => finding.rule_id === 'rule.budget.monthly.cap')?.outcome,
  ).toBe('pass');
  cost.total.currency = 'EUR';
  const invalid = await fixture.compatibility.evaluate(build, { costEstimate: cost });
  expect(
    invalid.findings.find((finding) => finding.rule_id === 'rule.budget.monthly.cap')?.outcome,
  ).toBe('unknown');
});

it.each([
  ['inference.estimated_required_vram_gb', 'rule.vram.estimate.fit'],
  ['inference.estimated_peak_per_device_vram_gb', 'rule.vram.per.device.fit'],
] as const)(
  'does not use %s with an incompatible unit for local compatibility',
  async (metric, ruleId) => {
    const build = selfHosted();
    const resource = resourceEstimate(build, '20', 'calibrated');
    const valid = await fixture.compatibility.evaluate(build, { resourceEstimate: resource });
    expect(valid.findings.find((finding) => finding.rule_id === ruleId)?.outcome).toBe('pass');
    resource.estimates = resource.estimates.map((entry) =>
      entry.metric === metric ? { ...entry, unit: 'watt' as const } : entry,
    );
    assertContract('ResourceEstimate', resource);
    const invalid = await fixture.compatibility.evaluate(build, { resourceEstimate: resource });
    expect(invalid.findings.find((finding) => finding.rule_id === ruleId)?.outcome).toBe('unknown');
  },
);

it.each([false, true])(
  'keeps a conflicting duplicate metric unknown regardless of order (reverse: %s)',
  async (reverse) => {
    const build = selfHosted();
    const resource = resourceEstimate(build, '20', 'calibrated');
    const metric = resource.estimates.find(
      (entry) => entry.metric === 'inference.estimated_required_vram_gb',
    );
    if (!metric) throw new Error('Missing metric');
    resource.estimates.push({ ...metric, value: '200' });
    if (reverse) resource.estimates.reverse();
    assertContract('ResourceEstimate', resource);
    const report = await fixture.compatibility.evaluate(build, { resourceEstimate: resource });
    expect(
      report.findings.find((finding) => finding.rule_id === 'rule.vram.estimate.fit')?.outcome,
    ).toBe('unknown');
    expect(
      report.findings.find((finding) => finding.rule_id === 'rule.vram.per.device.fit')?.outcome,
    ).toBe('pass');
  },
);

it('withholds an entirely ambiguous resource document without changing the input', async () => {
  const build = selfHosted();
  const resource = resourceEstimate(build, '20', 'calibrated');
  const metric = resource.estimates[0];
  if (!metric) throw new Error('Missing metric');
  resource.estimates = [metric, { ...metric }];
  const before = structuredClone(resource);
  const report = await fixture.compatibility.evaluate(build, { resourceEstimate: resource });
  expect(
    report.findings.find((finding) => finding.rule_id === 'rule.vram.estimate.fit')?.outcome,
  ).toBe('unknown');
  expect(resource).toEqual(before);
});

it('retains a single qualified metric when another estimate is below the confidence threshold', async () => {
  const build = selfHosted();
  const resource = resourceEstimate(build, '20', 'calibrated');
  const metric = resource.estimates.find(
    (entry) => entry.metric === 'inference.estimated_required_vram_gb',
  );
  if (!metric) throw new Error('Missing metric');
  resource.estimates.unshift({ ...metric, value: '200', confidence: 'estimated' });
  const report = await fixture.compatibility.evaluate(build, { resourceEstimate: resource });
  expect(
    report.findings.find((finding) => finding.rule_id === 'rule.vram.estimate.fit')?.outcome,
  ).toBe('pass');
});

it.each([
  ['a nonexistent selection', ['sel_nonexistent']],
  ['no selections', []],
] as const)(
  'does not use resource evidence tied to %s for local compatibility',
  async (_label, selectionIds) => {
    const build = selfHosted();
    const resource = resourceEstimate(build, '20', 'calibrated');
    resource.estimates = resource.estimates.map((entry) => ({
      ...entry,
      selection_ids: [...selectionIds],
    }));
    if (selectionIds.length) assertContract('ResourceEstimate', resource);
    const report = await fixture.compatibility.evaluate(build, { resourceEstimate: resource });
    expect(
      report.findings.find((finding) => finding.rule_id === 'rule.vram.estimate.fit')?.outcome,
    ).toBe('unknown');
  },
);

it('does not use a foreign pricebook estimate for the local budget rule', async () => {
  const build = updateObjectives(buildWith([['cost_policy', 'hard-cap']], apiChat()), {
    monthly_budget_amount: '10000.00',
  });
  build.locks.pricebook_id = DEMO_PRICEBOOK.id;
  const cost = await fixture.pricing.estimate(build);
  const valid = await fixture.compatibility.evaluate(build, { costEstimate: cost });
  expect(
    valid.findings.find((finding) => finding.rule_id === 'rule.budget.monthly.cap')?.outcome,
  ).toBe('pass');
  const foreign = assertContract('CostEstimate', { ...cost, pricebook_id: 'pricebook.foreign' });
  const invalid = await fixture.compatibility.evaluate(build, { costEstimate: foreign });
  expect(
    invalid.findings.find((finding) => finding.rule_id === 'rule.budget.monthly.cap')?.outcome,
  ).toBe('unknown');
});

describe('HTTP cost response context', () => {
  it('accepts a consistent foreign-currency estimate without converting it', async () => {
    const build = pinnedBuild();
    const estimate = structuredClone(await fixture.pricing.estimate(build));
    estimate.currency = 'EUR';
    estimate.subtotal.currency = 'EUR';
    estimate.tax.currency = 'EUR';
    estimate.total.currency = 'EUR';
    for (const line of estimate.line_items) {
      line.unit_price.currency = 'EUR';
      line.amount.currency = 'EUR';
    }
    assertContract('CostEstimate', estimate);
    await expect(providers(responseApi(estimate)).pricing.estimate(build)).resolves.toEqual(
      estimate,
    );
  });

  it.each(['subtotal', 'tax', 'total', 'line amount', 'unit price'] as const)(
    'rejects a schema-valid estimate with inconsistent %s currency',
    async (field) => {
      const build = pinnedBuild();
      const estimate = await fixture.pricing.estimate(build);
      const line = estimate.line_items[0];
      if (!line) throw new Error('Expected a priced fixture line');
      const altered = structuredClone(estimate);
      if (field === 'subtotal' || field === 'tax' || field === 'total') {
        altered[field].currency = 'EUR';
      } else {
        const first = altered.line_items[0];
        if (!first) throw new Error('Expected a priced fixture line');
        (field === 'line amount' ? first.amount : first.unit_price).currency = 'EUR';
      }
      assertContract('CostEstimate', altered);
      await expect(providers(responseApi(altered)).pricing.estimate(build)).rejects.toMatchObject({
        kind: 'malformed',
        contract: 'CostEstimate',
      });
    },
  );

  it.each(['locked', 'configured'] as const)(
    'rejects a schema-valid foreign %s pricebook',
    async (source) => {
      const build = pinnedBuild();
      const estimate = await fixture.pricing.estimate(build);
      if (source === 'configured') delete build.locks.pricebook_id;
      assertContract('BuildSnapshot', build);
      const response = assertContract('CostEstimate', {
        ...estimate,
        pricebook_id: 'pricebook.foreign',
      });
      const api = responseApi(response);
      await expect(providers(api).pricing.estimate(build)).rejects.toMatchObject({
        kind: 'malformed',
        contract: 'CostEstimate',
      });
      expect(api).toHaveBeenCalledExactlyOnceWith(
        `https://api.test/v1/builds/${build.id}/estimate-cost`,
        expect.objectContaining({
          body: JSON.stringify({
            build_revision: build.revision,
            pricebook_id: DEMO_PRICEBOOK.id,
            period_days: 30,
          }),
        }),
      );
    },
  );

  it('rejects a schema-valid estimate for a different requested period', async () => {
    const build = pinnedBuild();
    const response = await fixture.pricing.estimate(build, 30);
    assertContract('CostEstimate', response);
    await expect(
      providers(responseApi(response)).pricing.estimate(build, 14),
    ).rejects.toMatchObject({
      kind: 'malformed',
      contract: 'CostEstimate',
    });
  });

  it.each([undefined, 14])('accepts the requested period (default if %s)', async (periodDays) => {
    const build = pinnedBuild();
    const response = await fixture.pricing.estimate(build, periodDays);
    const api = responseApi(response);
    await expect(providers(api).pricing.estimate(build, periodDays)).resolves.toEqual(response);
    expect(api).toHaveBeenCalledExactlyOnceWith(
      `https://api.test/v1/builds/${build.id}/estimate-cost`,
      expect.objectContaining({
        body: JSON.stringify({
          build_revision: build.revision,
          pricebook_id: DEMO_PRICEBOOK.id,
          period_days: periodDays ?? 30,
        }),
        headers: expect.objectContaining({ 'Idempotency-Key': expect.any(String) }),
      }),
    );
  });

  it('prefers the explicit build pricebook over the configured default', async () => {
    const build = pinnedBuild();
    const response = await fixture.pricing.estimate(build);
    const api = responseApi(response);
    await expect(providers(api, 'pricebook.default').pricing.estimate(build)).resolves.toEqual(
      response,
    );
    expect(JSON.parse(String(api.mock.calls[0]?.[1]?.body)).pricebook_id).toBe(DEMO_PRICEBOOK.id);
  });

  it('accepts the configured pricebook when the optional build lock is absent', async () => {
    const build = pinnedBuild();
    const response = await fixture.pricing.estimate(build);
    delete build.locks.pricebook_id;
    assertContract('BuildSnapshot', build);
    await expect(providers(responseApi(response)).pricing.estimate(build)).resolves.toEqual(
      response,
    );
  });

  it('keeps missing pricebook configuration unsupported without dispatching', async () => {
    const build = pinnedBuild();
    delete build.locks.pricebook_id;
    assertContract('BuildSnapshot', build);
    const api = responseApi({});
    const http = createHttpProviders({
      baseUrl: 'https://api.test/v1',
      catalogSnapshotId: CATALOG.id,
      fetch: api,
    });
    await expect(http.pricing.estimate(build)).rejects.toMatchObject({ kind: 'unsupported' });
    expect(api).not.toHaveBeenCalled();
  });

  it.each(['build_id', 'build_revision'] as const)(
    'continues rejecting foreign %s',
    async (field) => {
      const build = pinnedBuild();
      const response = assertContract('CostEstimate', {
        ...(await fixture.pricing.estimate(build)),
        [field]: field === 'build_id' ? 'build.foreign' : build.revision + 1,
      });
      await expect(providers(responseApi(response)).pricing.estimate(build)).rejects.toMatchObject({
        kind: 'malformed',
        contract: 'CostEstimate',
      });
    },
  );

  it.each([false, true])(
    'binds cost to dispatch context when caller changes (foreign response: %s)',
    async (foreign) => {
      const build: BuildSnapshot = pinnedBuild();
      const original = structuredClone(build);
      const estimate = await fixture.pricing.estimate(build, 14);
      const changed = { build_id: 'build.changed', build_revision: build.revision + 1 };
      const response = assertContract(
        'CostEstimate',
        foreign ? { ...estimate, ...changed } : estimate,
      );
      const api = responseApi(response, () => {
        build.id = changed.build_id;
        build.revision = changed.build_revision;
        build.locks.pricebook_id = 'pricebook.changed';
      });
      const pending = providers(api).pricing.estimate(build, 14);
      if (foreign) {
        await expect(pending).rejects.toMatchObject({
          kind: 'malformed',
          contract: 'CostEstimate',
        });
      } else {
        await expect(pending).resolves.toEqual(estimate);
      }
      expect(api).toHaveBeenCalledExactlyOnceWith(
        `https://api.test/v1/builds/${original.id}/estimate-cost`,
        expect.objectContaining({
          body: JSON.stringify({
            build_revision: original.revision,
            pricebook_id: DEMO_PRICEBOOK.id,
            period_days: 14,
          }),
        }),
      );
    },
  );
});
