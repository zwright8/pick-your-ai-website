import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { expect, it, vi } from 'vitest';
import { DataContext } from '../../src/app/data-context';
import { useBuildAnalysis, useCompatibleOptions } from '../../src/app/queries';
import type { CostEstimate, EvaluationReport } from '../../src/contracts';
import { createFixtureProviders } from '../../src/data/fixture/providers';
import { useCompatByKind } from '../../src/lib/compat';
import { NOW, apiChat } from './scenarios';

it('withholds analysis when accepted content changes at the same build revision', async () => {
  const previous = apiChat();
  const accepted = { ...previous, objectives: { ...previous.objectives, requests_per_day: 9000 } };
  const providers = createFixtureProviders({ now: () => NOW });
  const oldCost = await providers.pricing.estimate(previous);
  const oldReport = await providers.compatibility.evaluate(previous, { costEstimate: oldCost });
  let resolveCost!: (value: CostEstimate) => void;
  let resolveReport!: (value: EvaluationReport) => void;
  const nextCost = new Promise<CostEstimate>((resolve) => {
    resolveCost = resolve;
  });
  const nextReport = new Promise<EvaluationReport>((resolve) => {
    resolveReport = resolve;
  });
  const estimate = vi
    .spyOn(providers.pricing, 'estimate')
    .mockImplementation((build) => (build === accepted ? nextCost : Promise.resolve(oldCost)));
  const evaluate = vi
    .spyOn(providers.compatibility, 'evaluate')
    .mockImplementation((build) => (build === accepted ? nextReport : Promise.resolve(oldReport)));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <DataContext.Provider value={providers}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </DataContext.Provider>
  );
  const hook = renderHook(({ build }) => useBuildAnalysis(build), {
    initialProps: { build: previous },
    wrapper,
  });
  await waitFor(() => expect(hook.result.current.reportIsCurrent).toBe(true));
  expect(hook.result.current.costIsCurrent).toBe(true);

  hook.rerender({ build: accepted });
  expect(hook.result.current.costIsCurrent).toBe(false);
  expect(hook.result.current.reportIsCurrent).toBe(false);
  await waitFor(() => expect(estimate).toHaveBeenCalledWith(accepted, 30));
  await waitFor(() =>
    expect(evaluate).toHaveBeenCalledWith(accepted, { costEstimate: null, resourceEstimate: null }),
  );

  const currentCost = { ...oldCost, id: 'cost.normalized' };
  await act(async () => resolveCost(currentCost));
  await waitFor(() =>
    expect(evaluate).toHaveBeenCalledWith(
      accepted,
      expect.objectContaining({ costEstimate: currentCost }),
    ),
  );
  expect(hook.result.current.reportIsCurrent).toBe(false);
  await act(async () => resolveReport({ ...oldReport, id: 'report.normalized' }));
  await waitFor(() => expect(hook.result.current.reportIsCurrent).toBe(true));
  hook.unmount();
  client.clear();
});

it('treats compatible-option results as stale when content changes at the same revision', async () => {
  const previous = apiChat();
  const accepted = { ...previous, objectives: { ...previous.objectives, requests_per_day: 9000 } };
  const providers = createFixtureProviders({ now: () => NOW });
  const oldOptions = await providers.compatibility.compatibleOptions(previous, 'model');
  let resolveOptions!: (value: typeof oldOptions) => void;
  const nextOptions = new Promise<typeof oldOptions>((resolve) => {
    resolveOptions = resolve;
  });
  const options = vi
    .spyOn(providers.compatibility, 'compatibleOptions')
    .mockImplementation((build) =>
      build === accepted ? nextOptions : Promise.resolve(oldOptions),
    );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <DataContext.Provider value={providers}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </DataContext.Provider>
  );
  const hook = renderHook(({ build }) => useCompatibleOptions(build, 'model'), {
    initialProps: { build: previous },
    wrapper,
  });
  await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
  hook.rerender({ build: accepted });
  expect(hook.result.current.isPlaceholderData).toBe(true);
  await waitFor(() => expect(options).toHaveBeenCalledWith(accepted, 'model', 'primary'));
  await act(async () => resolveOptions([]));
  await waitFor(() => expect(hook.result.current.isPlaceholderData).toBe(false));
  expect(hook.result.current.data).toEqual([]);
  hook.unmount();
  client.clear();
});

it('does not reuse catalog compatibility when content changes at the same revision', async () => {
  const previous = apiChat();
  const accepted = { ...previous, objectives: { ...previous.objectives, requests_per_day: 9000 } };
  const providers = createFixtureProviders({ now: () => NOW });
  const oldOptions = await providers.compatibility.compatibleOptions(previous, 'model');
  let resolveOptions!: (value: typeof oldOptions) => void;
  const nextOptions = new Promise<typeof oldOptions>((resolve) => {
    resolveOptions = resolve;
  });
  const options = vi
    .spyOn(providers.compatibility, 'compatibleOptions')
    .mockImplementation((build) =>
      build === accepted ? nextOptions : Promise.resolve(oldOptions),
    );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <DataContext.Provider value={providers}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </DataContext.Provider>
  );
  const hook = renderHook(({ build }) => useCompatByKind(build, ['model']), {
    initialProps: { build: previous },
    wrapper,
  });
  await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
  expect(hook.result.current.data.size).toBeGreaterThan(0);
  hook.rerender({ build: accepted });
  expect(hook.result.current.isSuccess).toBe(false);
  expect(hook.result.current.data.size).toBe(0);
  await waitFor(() => expect(options).toHaveBeenCalledWith(accepted, 'model', 'primary'));
  await act(async () => resolveOptions([]));
  await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
  hook.unmount();
  client.clear();
});
