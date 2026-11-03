import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { expect, it, vi } from 'vitest';
import { BuilderProvider, useBuilder } from '../../src/app/builder-context';
import { DataContext } from '../../src/app/data-context';
import { useBuildAnalysis } from '../../src/app/queries';
import type { CostEstimate } from '../../src/contracts';
import { createFixtureProviders } from '../../src/data/fixture/providers';
import type { StoredBuild } from '../../src/data/types';
import { NOW } from './scenarios';

it('recomputes analysis when the accepted save changes the current revision content', async () => {
  localStorage.clear();
  const providers = createFixtureProviders({ now: () => NOW });
  let resolveSave!: (value: StoredBuild) => void;
  const saveResult = new Promise<StoredBuild>((resolve) => {
    resolveSave = resolve;
  });
  const save = vi.spyOn(providers.builds, 'save').mockReturnValue(saveResult);
  const originalEstimate = providers.pricing.estimate.bind(providers.pricing);
  let resolveCost!: (value: CostEstimate) => void;
  const costResult = new Promise<CostEstimate>((resolve) => {
    resolveCost = resolve;
  });
  const estimate = vi
    .spyOn(providers.pricing, 'estimate')
    .mockImplementation((build) =>
      build.objectives.requests_per_day === 9000 ? costResult : originalEstimate(build),
    );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <DataContext.Provider value={providers}>
      <QueryClientProvider client={client}>
        <BuilderProvider>{children}</BuilderProvider>
      </QueryClientProvider>
    </DataContext.Provider>
  );
  const hook = renderHook(
    () => {
      const builder = useBuilder();
      const analysis = useBuildAnalysis(builder.draft?.build);
      return { builder, analysis };
    },
    { wrapper },
  );
  await waitFor(() => expect(hook.result.current.builder.ready).toBe(true));
  act(() =>
    hook.result.current.builder.apply(
      (build) => ({ ...build, objectives: { ...build.objectives, requests_per_day: 100 } }),
      'Change workload',
      [],
    ),
  );
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  await waitFor(() => expect(hook.result.current.analysis.costIsCurrent).toBe(true));
  const submitted = save.mock.calls[0]?.[0];
  if (!submitted) throw new Error('No submitted draft');
  const acceptedBuild = {
    ...submitted.build,
    objectives: { ...submitted.build.objectives, requests_per_day: 9000 },
  };
  const accepted = {
    ...submitted,
    build: acceptedBuild,
    revisions: submitted.revisions.map((revision) =>
      revision.revision === acceptedBuild.revision ? acceptedBuild : revision,
    ),
  };
  const currentCost = await originalEstimate(acceptedBuild);

  await act(async () => resolveSave(accepted));
  expect(hook.result.current.builder.draft?.build.objectives.requests_per_day).toBe(9000);
  expect(hook.result.current.analysis.costIsCurrent).toBe(false);
  await waitFor(() => expect(estimate).toHaveBeenCalledWith(acceptedBuild, 30));
  await act(async () => resolveCost(currentCost));
  await waitFor(() => expect(hook.result.current.analysis.costIsCurrent).toBe(true));
  hook.unmount();
  client.clear();
});
