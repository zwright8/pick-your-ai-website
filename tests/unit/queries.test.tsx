import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { DataContext } from '../../src/app/data-context';
import { useBuildAnalysis } from '../../src/app/queries';
import { useBuilder } from '../../src/app/builder-context';
import type { BuildSnapshot, CostEstimate, EvaluationReport } from '../../src/contracts';
import { createFixtureProviders } from '../../src/data/fixture/providers';
import type { ResourceEstimateResult } from '../../src/data/types';
import { createDraft, updateObjectives } from '../../src/domain/build';
import { DEMO_PRICEBOOK } from '../../src/data/fixture/pricebook';
import BuildSummaryPage from '../../src/pages/BuildSummaryPage';
import { BY_ID, NOW, apiChat, buildWith, resourceEstimate, selfHosted } from './scenarios';

vi.mock('../../src/app/builder-context', () => ({ useBuilder: vi.fn() }));

function wrapperFor(providers: ReturnType<typeof createFixtureProviders>, client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <DataContext.Provider value={providers}>
          <MemoryRouter>{children}</MemoryRouter>
        </DataContext.Provider>
      </QueryClientProvider>
    );
  };
}

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

async function analysisHarness() {
  const build = apiChat();
  const providers = createFixtureProviders({ now: () => NOW });
  const cost = await providers.pricing.estimate(build);
  const resources: ResourceEstimateResult = {
    status: 'available',
    estimate: resourceEstimate(build, '8', 'calibrated'),
  };
  const report = await providers.compatibility.evaluate(build, {
    costEstimate: cost,
    resourceEstimate: resources.estimate,
  });
  const nextCost = deferred<CostEstimate>();
  const nextResources = deferred<ResourceEstimateResult>();
  const nextReport = deferred<EvaluationReport>();
  const estimate = vi
    .spyOn(providers.pricing, 'estimate')
    .mockImplementation((b) => (b === build ? Promise.resolve(cost) : nextCost.promise));
  const estimateResources = vi
    .spyOn(providers.resources, 'estimate')
    .mockImplementation((b) => (b === build ? Promise.resolve(resources) : nextResources.promise));
  const evaluate = vi
    .spyOn(providers.compatibility, 'evaluate')
    .mockImplementation((b) => (b === build ? Promise.resolve(report) : nextReport.promise));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const wrapper = wrapperFor(providers, client);
  const initialProps: { current: BuildSnapshot | null } = { current: build };
  const hook = renderHook(
    ({ current }: { current: BuildSnapshot | null }) => {
      const analysis = useBuildAnalysis(current);
      return {
        ...analysis,
        costError: analysis.costQuery.isError,
        resourceError: analysis.resourcesQuery.isError,
        evaluationError: analysis.evaluation.isError,
      };
    },
    {
      initialProps,
      wrapper,
    },
  );
  await waitFor(() => expect(hook.result.current.reportIsCurrent).toBe(true));
  expect(hook.result.current.costIsCurrent).toBe(true);
  return {
    ...hook,
    wrapper,
    build,
    cost,
    resources,
    report,
    nextCost,
    nextResources,
    nextReport,
    estimate,
    estimateResources,
    evaluate,
  };
}

describe('build analysis identity', () => {
  it('rejects capacity evidence tied to disabled selections and recovers on retry', async () => {
    const build = selfHosted();
    const model = build.selections.find((selection) => selection.id === 'sel_model');
    if (!model) throw new Error('Missing model');
    build.selections.push({
      ...model,
      id: 'sel_model_disabled',
      role: 'secondary',
      enabled: false,
    });
    const providers = createFixtureProviders({ now: () => NOW });
    const valid = resourceEstimate(build, '20', 'calibrated');
    const invalid = {
      ...valid,
      estimates: valid.estimates.map((entry) => ({
        ...entry,
        selection_ids: ['sel_model_disabled'],
      })),
    };
    const estimate = vi
      .spyOn(providers.resources, 'estimate')
      .mockResolvedValue({ status: 'available', estimate: invalid });
    vi.mocked(useBuilder).mockReturnValue({
      draft: createDraft(build),
      ready: true,
      catalogById: BY_ID,
      lastChange: null,
      saveState: { status: 'saved' },
      apply: vi.fn(),
      startNew: vi.fn(),
      open: vi.fn(),
      restore: vi.fn(),
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const wrapper = wrapperFor(providers, client);
    const hook = renderHook(() => useBuildAnalysis(build), { wrapper });
    const view = render(<BuildSummaryPage />, { wrapper });
    const capacity = await screen.findByRole('region', { name: 'Capacity evidence' });
    await waitFor(() =>
      expect(capacity).toHaveTextContent(
        'Resource evidence references missing or disabled selections.',
      ),
    );
    await waitFor(() => expect(hook.result.current.reportIsCurrent).toBe(true));
    expect(
      hook.result.current.report?.findings.find(
        (finding) => finding.rule_id === 'rule.vram.estimate.fit',
      )?.outcome,
    ).toBe('unknown');
    estimate.mockResolvedValue({ status: 'available', estimate: valid });
    fireEvent.click(within(capacity).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(capacity).toHaveTextContent('20 gb'));
    await waitFor(() => {
      expect(hook.result.current.reportIsCurrent).toBe(true);
      expect(
        hook.result.current.report?.findings.find(
          (finding) => finding.rule_id === 'rule.vram.estimate.fit',
        )?.outcome,
      ).toBe('pass');
    });
    view.unmount();
    hook.unmount();
    client.clear();
  });

  it('explains ambiguous capacity evidence while withholding it from the affected local rule', async () => {
    const build = selfHosted();
    const providers = createFixtureProviders({ now: () => NOW });
    const estimate = resourceEstimate(build, '20', 'calibrated');
    const metric = estimate.estimates[0];
    if (!metric) throw new Error('Missing metric');
    estimate.estimates.push({ ...metric, value: '200' });
    vi.spyOn(providers.resources, 'estimate').mockResolvedValue({ status: 'available', estimate });
    vi.mocked(useBuilder).mockReturnValue({
      draft: createDraft(build),
      ready: true,
      catalogById: BY_ID,
      lastChange: null,
      saveState: { status: 'saved' },
      apply: vi.fn(),
      startNew: vi.fn(),
      open: vi.fn(),
      restore: vi.fn(),
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const wrapper = wrapperFor(providers, client);
    const hook = renderHook(() => useBuildAnalysis(build), { wrapper });
    await waitFor(() => expect(hook.result.current.resources?.status).toBe('available'));
    await waitFor(() => {
      expect(hook.result.current.reportIsCurrent).toBe(true);
      expect(
        hook.result.current.report?.findings.find(
          (finding) => finding.rule_id === 'rule.vram.estimate.fit',
        )?.outcome,
      ).toBe('unknown');
      expect(
        hook.result.current.report?.findings.find(
          (finding) => finding.rule_id === 'rule.vram.per.device.fit',
        )?.outcome,
      ).toBe('pass');
    });
    const view = render(<BuildSummaryPage />, { wrapper });
    const capacity = await screen.findByRole('region', { name: 'Capacity evidence' });
    expect(capacity).toHaveTextContent(
      'Multiple qualifying estimates for the same metric are not used',
    );
    expect(capacity).toHaveTextContent('20 gb');
    expect(capacity).toHaveTextContent('200 gb');
    view.unmount();
    hook.unmount();
    client.clear();
  });

  it.each([
    'build_id',
    'build_revision',
    'catalog_snapshot_id',
    'ruleset_id',
    'ruleset_version',
    'dependency_graph_id',
    'dependency_graph_revision',
  ] as const)('rejects a report with a mismatched %s', async (field) => {
    const h = await analysisHarness();
    const invalid = structuredClone(h.report);
    if (field === 'build_revision') invalid.build_revision += 1;
    else if (field === 'dependency_graph_revision') invalid.dependency_graph_revision += 1;
    else invalid[field] = 'foreign';
    h.evaluate.mockResolvedValue(invalid);
    await act(async () => {
      await h.result.current.evaluation.refetch();
    });
    await waitFor(() => expect(h.result.current.evaluationError).toBe(true));
    expect(h.result.current.reportIsCurrent).toBe(false);
    if (field === 'ruleset_id') {
      vi.mocked(useBuilder).mockReturnValue({
        draft: createDraft(h.build),
        ready: true,
        catalogById: BY_ID,
        lastChange: null,
        saveState: { status: 'saved' },
        apply: vi.fn(),
        startNew: vi.fn(),
        open: vi.fn(),
        restore: vi.fn(),
      });
      const view = render(<BuildSummaryPage />, { wrapper: h.wrapper });
      await screen.findByText(
        'Evaluation report does not match the build or its pinned artifacts.',
      );
      h.evaluate.mockResolvedValue(h.report);
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      await waitFor(() => expect(h.result.current.reportIsCurrent).toBe(true));
      view.unmount();
    }
    h.unmount();
  });

  it.each([
    'wrong build',
    'wrong revision',
    'wrong pricebook',
    'mixed currency',
    'inconsistent total',
    'wrong period',
    'contradictory coverage',
    'foreign line',
    'foreign unpriced selection',
  ] as const)('rejects %s cost evidence and shows an unavailable state', async (problem) => {
    const h = await analysisHarness();
    const invalid = structuredClone(h.cost);
    if (problem === 'wrong build') invalid.build_id = 'build.foreign';
    if (problem === 'wrong revision') invalid.build_revision += 1;
    if (problem === 'wrong pricebook') invalid.pricebook_id = 'pricebook.foreign';
    if (problem === 'mixed currency') invalid.total.currency = 'EUR';
    if (problem === 'inconsistent total') invalid.total.amount = '0';
    if (problem === 'wrong period') invalid.period_days = 7;
    if (problem === 'contradictory coverage') {
      invalid.coverage = 'complete';
      invalid.unpriced_selection_ids = ['sel_model'];
    }
    if (problem === 'foreign line') {
      const line = invalid.line_items[0];
      if (!line) throw new Error('Missing priced fixture line');
      line.selection_id = 'sel_foreign';
    }
    if (problem === 'foreign unpriced selection') {
      invalid.coverage = 'partial';
      invalid.unpriced_selection_ids = ['sel_foreign'];
    }
    h.estimate.mockResolvedValue(invalid);
    h.evaluate.mockClear();
    await act(async () => {
      await h.result.current.costQuery.refetch();
    });
    await waitFor(() => expect(h.result.current.costError).toBe(true));
    expect(h.result.current.costIsCurrent).toBe(false);
    await waitFor(() =>
      expect(h.evaluate).toHaveBeenCalledWith(h.build, {
        costEstimate: null,
        resourceEstimate: h.resources.status === 'available' ? h.resources.estimate : null,
      }),
    );
    vi.mocked(useBuilder).mockReturnValue({
      draft: createDraft(h.build),
      ready: true,
      catalogById: BY_ID,
      lastChange: null,
      saveState: { status: 'saved' },
      apply: vi.fn(),
      startNew: vi.fn(),
      open: vi.fn(),
      restore: vi.fn(),
    });
    const view = render(<BuildSummaryPage />, { wrapper: h.wrapper });
    const cost = await screen.findByRole('region', { name: 'Cost breakdown' });
    await waitFor(() => expect(cost).toHaveTextContent('Cost estimate unavailable'));
    expect(cost).not.toHaveTextContent('Estimating cost');
    if (problem === 'wrong pricebook') {
      h.estimate.mockResolvedValue(h.cost);
      h.evaluate.mockClear();
      fireEvent.click(within(cost).getByRole('button', { name: 'Try again' }));
      await waitFor(() => expect(cost).toHaveTextContent('$324.00'));
      await waitFor(() =>
        expect(h.evaluate).toHaveBeenCalledWith(h.build, {
          costEstimate: h.cost,
          resourceEstimate: h.resources.status === 'available' ? h.resources.estimate : null,
        }),
      );
    }
    view.unmount();
    h.unmount();
  });

  it('does not treat a failed cost refresh as current evidence', async () => {
    const h = await analysisHarness();
    h.estimate.mockRejectedValue(new Error('pricing unavailable'));
    let refreshStatus = '';
    await act(async () => {
      refreshStatus = (await h.result.current.costQuery.refetch()).status;
    });
    expect(refreshStatus).toBe('error');
    await waitFor(() => expect(h.result.current.costError).toBe(true));
    expect(h.result.current.costIsCurrent).toBe(false);
    await waitFor(() =>
      expect(h.evaluate).toHaveBeenCalledWith(h.build, {
        costEstimate: null,
        resourceEstimate: h.resources.status === 'available' ? h.resources.estimate : null,
      }),
    );
    h.unmount();
  });

  it('does not treat a failed resource refresh as current evidence', async () => {
    const h = await analysisHarness();
    h.estimateResources.mockRejectedValue(new Error('resources unavailable'));
    await act(async () => {
      await h.result.current.resourcesQuery.refetch();
    });
    await waitFor(() => expect(h.result.current.resourceError).toBe(true));
    expect(h.result.current.resources).toBeUndefined();
    await waitFor(() =>
      expect(h.evaluate).toHaveBeenCalledWith(h.build, {
        costEstimate: h.cost,
        resourceEstimate: null,
      }),
    );
    h.unmount();
  });

  it.each([
    'wrong unit',
    'wrong build',
    'wrong revision',
    'wrong selection',
    'empty selections',
    'empty metrics',
    'provider error',
  ] as const)('reports %s capacity evidence as unavailable', async (problem) => {
    const h = await analysisHarness();
    if (h.resources.status !== 'available') throw new Error('Expected resource fixture');
    const invalid = structuredClone(h.resources.estimate);
    const first = invalid.estimates[0];
    if (!first) throw new Error('Missing resource metric');
    if (problem === 'wrong unit') first.unit = 'watt';
    if (problem === 'wrong build') invalid.build_id = 'build.foreign';
    if (problem === 'wrong revision') invalid.build_revision += 1;
    if (problem === 'wrong selection') first.selection_ids = ['sel_nonexistent'];
    if (problem === 'empty selections') first.selection_ids = [];
    if (problem === 'empty metrics') invalid.estimates = [];
    if (problem === 'provider error')
      h.estimateResources.mockRejectedValue(new Error('Unavailable'));
    else h.estimateResources.mockResolvedValue({ status: 'available', estimate: invalid });
    await act(async () => {
      await h.result.current.resourcesQuery.refetch();
    });
    await waitFor(() => expect(h.result.current.resourceError).toBe(true));
    expect(h.result.current.resources).toBeUndefined();
    await waitFor(() =>
      expect(h.evaluate).toHaveBeenCalledWith(h.build, {
        costEstimate: h.cost,
        resourceEstimate: null,
      }),
    );
    vi.mocked(useBuilder).mockReturnValue({
      draft: createDraft(h.build),
      ready: true,
      catalogById: BY_ID,
      lastChange: null,
      saveState: { status: 'saved' },
      apply: vi.fn(),
      startNew: vi.fn(),
      open: vi.fn(),
      restore: vi.fn(),
    });
    const view = render(<BuildSummaryPage />, { wrapper: h.wrapper });
    const capacity = await screen.findByRole('region', { name: 'Capacity evidence' });
    await waitFor(() => expect(capacity).toHaveTextContent('Capacity evidence unavailable'));
    expect(capacity).not.toHaveTextContent('Checking capacity evidence');
    expect(capacity).not.toHaveTextContent('8 watt');
    if (problem === 'wrong unit') {
      h.estimateResources.mockResolvedValue(h.resources);
      h.evaluate.mockClear();
      fireEvent.click(within(capacity).getByRole('button', { name: 'Try again' }));
      await waitFor(() => expect(capacity).toHaveTextContent('8 gb'));
      await waitFor(() =>
        expect(h.evaluate).toHaveBeenCalledWith(h.build, {
          costEstimate: h.cost,
          resourceEstimate: h.resources.status === 'available' ? h.resources.estimate : null,
        }),
      );
    }
    view.unmount();
    h.unmount();
  });

  it('does not mark an old evaluation current after a failed refresh', async () => {
    const h = await analysisHarness();
    h.evaluate.mockRejectedValue(new Error('evaluation unavailable'));
    await act(async () => {
      await h.result.current.evaluation.refetch();
    });
    await waitFor(() => expect(h.result.current.evaluationError).toBe(true));
    expect(h.result.current.reportIsCurrent).toBe(false);
    h.unmount();
  });

  it('reevaluates when capacity evidence changes under the same ID', async () => {
    const build = apiChat();
    const providers = createFixtureProviders({ now: () => NOW });
    const initial = resourceEstimate(build, '8', 'calibrated');
    const updated = resourceEstimate(build, '24', 'calibrated');
    expect(initial.id).toBe(updated.id);
    vi.spyOn(providers.resources, 'estimate').mockResolvedValue({
      status: 'available',
      estimate: initial,
    });
    const originalEvaluate = providers.compatibility.evaluate.bind(providers.compatibility);
    const pending = deferred<EvaluationReport>();
    const evaluate = vi
      .spyOn(providers.compatibility, 'evaluate')
      .mockImplementation((current, evidence) =>
        evidence?.resourceEstimate?.estimates[0]?.value === '24'
          ? pending.promise
          : originalEvaluate(current, evidence),
      );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const h = renderHook(() => useBuildAnalysis(build), { wrapper: wrapperFor(providers, client) });
    await waitFor(() => expect(h.result.current.reportIsCurrent).toBe(true));
    await waitFor(() =>
      expect(evaluate).toHaveBeenCalledWith(
        build,
        expect.objectContaining({ resourceEstimate: initial }),
      ),
    );
    act(() =>
      client.setQueryData(['resources', build.id, build.revision, build], {
        status: 'available',
        estimate: updated,
      }),
    );
    await waitFor(() =>
      expect(evaluate).toHaveBeenCalledWith(
        build,
        expect.objectContaining({ resourceEstimate: updated }),
      ),
    );
    expect(h.result.current.reportIsCurrent).toBe(false);
    const report = await originalEvaluate(build, {
      costEstimate: h.result.current.cost,
      resourceEstimate: updated,
    });
    await act(async () => pending.resolve(report));
    await waitFor(() => expect(h.result.current.reportIsCurrent).toBe(true));
    h.unmount();
    client.clear();
  });

  it('reevaluates the budget when a rate expires but the estimate ID is reused', async () => {
    let now = '2026-11-03T00:00:00Z';
    const pricebook = {
      ...DEMO_PRICEBOOK,
      rates: DEMO_PRICEBOOK.rates.map((rate) =>
        rate.id === 'rate.demo.aurora-large.out'
          ? { ...rate, valid_until: '2026-11-04T00:00:00Z' }
          : rate,
      ),
    };
    const providers = createFixtureProviders({ now: () => now, pricebook });
    const build = updateObjectives(buildWith([['cost_policy', 'hard-cap']], apiChat()), {
      monthly_budget_amount: '10000.00',
    });
    const originalEvaluate = providers.compatibility.evaluate.bind(providers.compatibility);
    const pending = deferred<EvaluationReport>();
    const evaluate = vi
      .spyOn(providers.compatibility, 'evaluate')
      .mockImplementation((current, evidence) =>
        evidence?.costEstimate?.coverage === 'partial'
          ? pending.promise
          : originalEvaluate(current, evidence),
      );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const h = renderHook(() => useBuildAnalysis(build), { wrapper: wrapperFor(providers, client) });
    await waitFor(() => expect(h.result.current.reportIsCurrent).toBe(true));
    expect(
      h.result.current.report?.findings.find(
        (finding) => finding.rule_id === 'rule.budget.monthly.cap',
      )?.outcome,
    ).toBe('pass');
    const oldId = h.result.current.cost?.id;
    now = '2026-11-05T00:00:00Z';
    await act(async () => {
      await h.result.current.costQuery.refetch();
    });
    await waitFor(() =>
      expect(evaluate).toHaveBeenCalledWith(
        build,
        expect.objectContaining({
          costEstimate: expect.objectContaining({ id: oldId, coverage: 'partial' }),
        }),
      ),
    );
    expect(h.result.current.reportIsCurrent).toBe(false);
    const updatedCost = h.result.current.cost;
    if (!updatedCost) throw new Error('Expected refreshed cost');
    const updatedReport = await originalEvaluate(build, { costEstimate: updatedCost });
    await act(async () => pending.resolve(updatedReport));
    await waitFor(() => expect(h.result.current.reportIsCurrent).toBe(true));
    expect(
      h.result.current.report?.findings.find(
        (finding) => finding.rule_id === 'rule.budget.monthly.cap',
      )?.outcome,
    ).toBe('unknown');
    h.unmount();
    client.clear();
  });

  it.each(['another build at the same revision', 'a new revision of the same build'])(
    'keeps placeholders stale and excludes their evidence for %s',
    async (change) => {
      const h = await analysisHarness();
      const nextBuild = {
        ...h.build,
        ...(change === 'another build at the same revision'
          ? { id: 'build.other' }
          : { revision: h.build.revision + 1 }),
      };
      h.rerender({ current: nextBuild });
      expect(h.result.current.costQuery.isPlaceholderData).toBe(true);
      expect(h.result.current.evaluation.isPlaceholderData).toBe(true);
      expect(h.result.current.cost).toEqual(h.cost);
      expect(h.result.current.report).toEqual(h.report);
      expect(h.result.current.costIsCurrent).toBe(false);
      expect(h.result.current.reportIsCurrent).toBe(false);
      expect(h.result.current.resourcesQuery.isPlaceholderData).toBe(true);
      expect(h.result.current.resources).toBeUndefined();
      await waitFor(() =>
        expect(h.evaluate).toHaveBeenCalledWith(nextBuild, {
          costEstimate: null,
          resourceEstimate: null,
        }),
      );

      const currentResources: ResourceEstimateResult = {
        status: 'available',
        estimate: resourceEstimate(nextBuild, '8', 'calibrated'),
      };
      await act(async () => h.nextResources.resolve(currentResources));
      await waitFor(() => expect(h.result.current.resources).toEqual(currentResources));
      const currentCost = { ...h.cost, build_id: nextBuild.id, build_revision: nextBuild.revision };
      await act(async () => h.nextCost.resolve(currentCost));
      await waitFor(() =>
        expect(h.evaluate).toHaveBeenCalledWith(nextBuild, {
          costEstimate: currentCost,
          resourceEstimate: currentResources.estimate,
        }),
      );
      expect(h.result.current.costIsCurrent).toBe(true);
      expect(h.result.current.reportIsCurrent).toBe(false);
      const currentReport = {
        ...h.report,
        build_id: nextBuild.id,
        build_revision: nextBuild.revision,
      };
      await act(async () => h.nextReport.resolve(currentReport));
      await waitFor(() => expect(h.result.current.reportIsCurrent).toBe(true));
      expect(h.result.current.report).toEqual(currentReport);
      expect(h.result.current.cost).toEqual(currentCost);
      for (const [build, evidence] of h.evaluate.mock.calls.filter(([b]) => b === nextBuild)) {
        for (const estimate of [evidence?.costEstimate, evidence?.resourceEstimate]) {
          if (estimate) {
            expect(estimate.build_id).toBe(build.id);
            expect(estimate.build_revision).toBe(build.revision);
          }
        }
      }
      h.unmount();
    },
  );

  it('does not mark placeholders current or request analysis without a build', async () => {
    const h = await analysisHarness();
    h.estimate.mockClear();
    h.estimateResources.mockClear();
    h.evaluate.mockClear();
    h.rerender({ current: null });
    expect(h.result.current.cost).toEqual(h.cost);
    expect(h.result.current.report).toEqual(h.report);
    expect(h.result.current.costIsCurrent).toBe(false);
    expect(h.result.current.reportIsCurrent).toBe(false);
    expect(h.result.current.resources).toBeUndefined();
    expect(h.estimate).not.toHaveBeenCalled();
    expect(h.estimateResources).not.toHaveBeenCalled();
    expect(h.evaluate).not.toHaveBeenCalled();
    h.unmount();
  });

  it('hides a previous build’s unavailable reason until the current resource request resolves', async () => {
    const build = apiChat();
    const providers = createFixtureProviders({ now: () => NOW });
    const pending = deferred<ResourceEstimateResult>();
    const previous: ResourceEstimateResult = {
      status: 'unavailable',
      reason: 'Previous build reason.',
    };
    vi.spyOn(providers.resources, 'estimate')
      .mockResolvedValueOnce(previous)
      .mockReturnValue(pending.promise);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const h = renderHook(({ current }) => useBuildAnalysis(current), {
      initialProps: { current: build },
      wrapper: wrapperFor(providers, client),
    });
    await waitFor(() => expect(h.result.current.resources).toEqual(previous));
    h.rerender({ current: { ...build, id: 'build.other' } });
    expect(h.result.current.resourcesQuery.isPlaceholderData).toBe(true);
    expect(h.result.current.resourcesQuery.data).toEqual(previous);
    expect(h.result.current.resources).toBeUndefined();
    const current: ResourceEstimateResult = {
      status: 'unavailable',
      reason: 'Current build reason.',
    };
    await act(async () => pending.resolve(current));
    await waitFor(() => expect(h.result.current.resources).toEqual(current));
    expect(h.result.current.resourcesQuery.isPlaceholderData).toBe(false);
    h.unmount();
  });

  it('reevaluates when resources arrive after cost and when either estimate identity changes', async () => {
    const build = apiChat();
    const providers = createFixtureProviders({ now: () => NOW });
    const report = await providers.compatibility.evaluate(build);
    const resources = deferred<ResourceEstimateResult>();
    vi.spyOn(providers.resources, 'estimate').mockReturnValue(resources.promise);
    const withoutResources = deferred<EvaluationReport>();
    const withResources = deferred<EvaluationReport>();
    const withUpdatedResources = deferred<EvaluationReport>();
    const withUpdatedCost = deferred<EvaluationReport>();
    const evaluate = vi
      .spyOn(providers.compatibility, 'evaluate')
      .mockReturnValueOnce(withoutResources.promise)
      .mockReturnValueOnce(withResources.promise)
      .mockReturnValueOnce(withUpdatedResources.promise)
      .mockReturnValueOnce(withUpdatedCost.promise);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const h = renderHook(() => useBuildAnalysis(build), { wrapper: wrapperFor(providers, client) });
    await waitFor(() => expect(evaluate).toHaveBeenCalledTimes(1));
    expect(evaluate).toHaveBeenLastCalledWith(build, {
      costEstimate: expect.objectContaining({ build_id: build.id, build_revision: build.revision }),
      resourceEstimate: null,
    });
    await act(async () => withoutResources.resolve(report));
    await waitFor(() => expect(h.result.current.reportIsCurrent).toBe(true));

    const estimate = resourceEstimate(build, '8', 'calibrated');
    await act(async () => resources.resolve({ status: 'available', estimate }));
    await waitFor(() => expect(evaluate).toHaveBeenCalledTimes(2));
    expect(evaluate).toHaveBeenLastCalledWith(build, {
      costEstimate: h.result.current.cost,
      resourceEstimate: estimate,
    });
    expect(h.result.current.report).toEqual(report);
    expect(h.result.current.reportIsCurrent).toBe(false);
    const updatedReport = { ...report, id: 'eval.with-resources' };
    await act(async () => withResources.resolve(updatedReport));
    await waitFor(() => expect(h.result.current.reportIsCurrent).toBe(true));
    expect(h.result.current.report).toEqual(updatedReport);

    const updatedEstimate = { ...estimate, id: 'resources.updated' };
    act(() =>
      client.setQueryData(['resources', build.id, build.revision, build], {
        status: 'available',
        estimate: updatedEstimate,
      }),
    );
    await waitFor(() => expect(evaluate).toHaveBeenCalledTimes(3));
    expect(evaluate).toHaveBeenLastCalledWith(build, {
      costEstimate: h.result.current.cost,
      resourceEstimate: updatedEstimate,
    });
    expect(h.result.current.reportIsCurrent).toBe(false);
    await act(async () =>
      withUpdatedResources.resolve({ ...report, id: 'eval.updated-resources' }),
    );
    await waitFor(() => expect(h.result.current.reportIsCurrent).toBe(true));

    const updatedCost = { ...h.result.current.cost!, id: 'cost.updated' };
    act(() => client.setQueryData(['cost', build.id, build.revision, build], updatedCost));
    await waitFor(() => expect(evaluate).toHaveBeenCalledTimes(4));
    expect(evaluate).toHaveBeenLastCalledWith(build, {
      costEstimate: updatedCost,
      resourceEstimate: updatedEstimate,
    });
    expect(h.result.current.reportIsCurrent).toBe(false);
    await act(async () => withUpdatedCost.resolve({ ...report, id: 'eval.updated-cost' }));
    await waitFor(() => expect(h.result.current.reportIsCurrent).toBe(true));
    expect(h.result.current.report?.id).toBe('eval.updated-cost');
    h.unmount();
  });

  it('hides another build’s capacity evidence in the summary until current resources arrive', async () => {
    const h = await analysisHarness();
    // The builder summary is the only summary view after the redesign, so this exercises it directly.
    function SummaryView({ build }: { build: BuildSnapshot }) {
      vi.mocked(useBuilder).mockReturnValue({
        draft: createDraft(build),
        ready: true,
        catalogById: BY_ID,
        lastChange: null,
        saveState: { status: 'saved' },
        apply: vi.fn(),
        startNew: vi.fn(),
        open: vi.fn(),
        restore: vi.fn(),
      });
      return <BuildSummaryPage />;
    }
    const view = render(<SummaryView build={h.build} />, { wrapper: h.wrapper });
    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Capacity evidence' })).toHaveTextContent('8 gb'),
    );

    const nextBuild = { ...h.build, id: 'build.other' };
    view.rerender(<SummaryView build={nextBuild} />);
    const capacity = screen.getByRole('region', { name: 'Capacity evidence' });
    await waitFor(() => expect(capacity).toHaveTextContent('Checking capacity evidence…'));
    expect(capacity).not.toHaveTextContent('8 gb');

    await act(async () =>
      h.nextResources.resolve({
        status: 'available',
        estimate: resourceEstimate(nextBuild, '16', 'calibrated'),
      }),
    );
    await waitFor(() => expect(capacity).toHaveTextContent('16 gb'));
    expect(capacity).not.toHaveTextContent('8 gb');
    view.unmount();
    h.unmount();
  });
});
