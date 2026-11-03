import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { expect, it, vi } from 'vitest';
import { DataContext } from '../../src/app/data-context';
import { createFixtureProviders } from '../../src/data/fixture/providers';
import { addOrReplace } from '../../src/domain/build';
import { useCompatByKind, verdictFor } from '../../src/lib/compat';
import { apiChat, BY_ID, item, NOW } from './scenarios';

it.each(['foreign', 'ambiguous', 'mixed'] as const)(
  'admits only an unambiguous verdict for the catalog version (%s)',
  async (scenario) => {
    const providers = createFixtureProviders({ now: () => NOW });
    const model = item('model', 'aurora-mini');
    const candidate = {
      catalog_item_id: model.id,
      catalog_item_version: model.version,
      verdict: 'incompatible' as const,
      rule_ids: [],
    };
    const other = {
      ...candidate,
      catalog_item_version: scenario === 'ambiguous' ? model.version : '9.0.0',
      verdict: 'compatible' as const,
    };
    vi.spyOn(providers.compatibility, 'compatibleOptions').mockResolvedValue(
      scenario === 'foreign' ? [other] : [candidate, other],
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const { result, unmount } = renderHook(() => useCompatByKind(apiChat(), ['model']), {
      wrapper: ({ children }: PropsWithChildren) => (
        <QueryClientProvider client={client}>
          <DataContext.Provider value={providers}>{children}</DataContext.Provider>
        </QueryClientProvider>
      ),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(verdictFor(result.current.data, 'model', model.id, model.version)).toBe(
      scenario === 'mixed' ? 'incompatible' : 'unknown',
    );
    unmount();
    client.clear();
  },
);

it('withholds cached compatibility after a refresh fails', async () => {
  const providers = createFixtureProviders({ now: () => NOW });
  const model = item('model', 'aurora-mini');
  const spy = vi.spyOn(providers.compatibility, 'compatibleOptions').mockResolvedValue([
    {
      catalog_item_id: model.id,
      catalog_item_version: model.version,
      verdict: 'compatible',
      rule_ids: [],
    },
  ]);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const { result, unmount } = renderHook(() => useCompatByKind(apiChat(), ['model']), {
    wrapper: ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={client}>
        <DataContext.Provider value={providers}>{children}</DataContext.Provider>
      </QueryClientProvider>
    ),
  });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(verdictFor(result.current.data, 'model', model.id, model.version)).toBe('compatible');
  spy.mockRejectedValue(new Error('Compatibility unavailable'));
  await client.invalidateQueries({ queryKey: ['compat-kind'] });
  await waitFor(() => expect(result.current.isError).toBe(true));
  expect(verdictFor(result.current.data, 'model', model.id, model.version)).toBe('unknown');
  unmount();
  client.clear();
});

it('reevaluates the same revision for additional and replacement roles', async () => {
  const providers = createFixtureProviders({ now: () => NOW });
  const spy = vi.spyOn(providers.compatibility, 'compatibleOptions');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>
      <DataContext.Provider value={providers}>{children}</DataContext.Provider>
    </QueryClientProvider>
  );
  const build = apiChat();
  const openlab = item('model_provider', 'openlab');
  const { result, rerender } = renderHook(
    ({ options }) => useCompatByKind(build, ['model_provider'], options),
    { wrapper, initialProps: { options: {} as { role?: string; additional?: boolean } } },
  );
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(verdictFor(result.current.data, 'model_provider', openlab.id, openlab.version)).toBe(
    'incompatible',
  );
  rerender({ options: { additional: true } });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(verdictFor(result.current.data, 'model_provider', openlab.id, openlab.version)).toBe(
    'compatible',
  );
  expect(spy).toHaveBeenLastCalledWith(build, 'model_provider', 'secondary');
  rerender({ options: { role: 'secondary' } });
  expect(verdictFor(result.current.data, 'model_provider', openlab.id, openlab.version)).toBe(
    'compatible',
  );
});

it('uses the next free role when adding a third selection', async () => {
  const providers = createFixtureProviders({ now: () => NOW });
  const spy = vi.spyOn(providers.compatibility, 'compatibleOptions');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const build = addOrReplace(apiChat(), item('model_provider', 'openlab'), BY_ID, {
    additional: true,
  });
  const { result } = renderHook(
    () => useCompatByKind(build, ['model_provider'], { additional: true }),
    {
      wrapper: ({ children }: PropsWithChildren) => (
        <QueryClientProvider client={client}>
          <DataContext.Provider value={providers}>{children}</DataContext.Provider>
        </QueryClientProvider>
      ),
    },
  );
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(spy).toHaveBeenCalledWith(build, 'model_provider', 'tertiary');
});

it('keeps successful kinds and exposes a failed kind for manual retry', async () => {
  const providers = createFixtureProviders({ now: () => NOW });
  const original = providers.compatibility.compatibleOptions.bind(providers.compatibility);
  let fails = true;
  const spy = vi
    .spyOn(providers.compatibility, 'compatibleOptions')
    .mockImplementation((build, kind, role) => {
      if (kind === 'model' && fails) return Promise.reject(new Error('Model catalog unavailable'));
      return original(build, kind, role);
    });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const { result } = renderHook(() => useCompatByKind(apiChat(), ['model', 'model_provider']), {
    wrapper: ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={client}>
        <DataContext.Provider value={providers}>{children}</DataContext.Provider>
      </QueryClientProvider>
    ),
  });
  await waitFor(() => expect(result.current.isError).toBe(true));
  await waitFor(() => expect(result.current.data.size).toBeGreaterThan(0));
  expect(result.current.error?.message).toBe('Model catalog unavailable');
  const successfulCalls = spy.mock.calls.filter((call) => call[1] === 'model_provider').length;
  fails = false;
  await result.current.refetch();
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(result.current.isError).toBe(false);
  expect(spy.mock.calls.filter((call) => call[1] === 'model_provider')).toHaveLength(
    successfulCalls,
  );
  client.clear();
});

it('automatically retries a failed kind without repeating successful kinds', async () => {
  const providers = createFixtureProviders({ now: () => NOW });
  const original = providers.compatibility.compatibleOptions.bind(providers.compatibility);
  let attempts = 0;
  const spy = vi
    .spyOn(providers.compatibility, 'compatibleOptions')
    .mockImplementation((build, kind, role) => {
      if (kind === 'model' && attempts++ === 0) return Promise.reject(new Error('Transient'));
      return original(build, kind, role);
    });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: 1, retryDelay: 0, gcTime: 0 } },
  });
  const { result } = renderHook(() => useCompatByKind(apiChat(), ['model', 'model_provider']), {
    wrapper: ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={client}>
        <DataContext.Provider value={providers}>{children}</DataContext.Provider>
      </QueryClientProvider>
    ),
  });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(spy.mock.calls.filter((call) => call[1] === 'model')).toHaveLength(2);
  expect(spy.mock.calls.filter((call) => call[1] === 'model_provider')).toHaveLength(1);
  client.clear();
});
