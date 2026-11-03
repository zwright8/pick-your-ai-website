import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BuilderProvider, useBuilder } from '../../src/app/builder-context';
import { DataContext } from '../../src/app/data-context';
import { useGraph } from '../../src/app/queries';
import { createFixtureProviders } from '../../src/data/fixture/providers';
import { createDraft } from '../../src/domain/build';
import { apiChat, NOW } from './scenarios';

beforeEach(() => localStorage.clear());

describe('pinned invalidation evidence', () => {
  it.each(['matching', 'foreign'] as const)(
    'only reports rechecked dependencies with a %s graph',
    async (graph) => {
      const build = apiChat();
      if (graph === 'foreign') build.locks.dependency_graph_id = 'graph.unavailable';
      const stored = createDraft(build);
      const providers = createFixtureProviders({ now: () => NOW });
      vi.spyOn(providers.builds, 'get').mockResolvedValue(stored);
      vi.spyOn(providers.builds, 'save').mockImplementation(async (draft) => draft);
      const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
      const wrapper = ({ children }: { children: ReactNode }) => (
        <DataContext.Provider value={providers}>
          <QueryClientProvider client={client}>
            <BuilderProvider>{children}</BuilderProvider>
          </QueryClientProvider>
        </DataContext.Provider>
      );
      const hook = renderHook(() => ({ builder: useBuilder(), graph: useGraph() }), { wrapper });
      await waitFor(() =>
        expect(hook.result.current.builder.ready && hook.result.current.graph.isSuccess).toBe(true),
      );
      await act(async () => {
        await hook.result.current.builder.open(build.id);
      });
      act(() =>
        hook.result.current.builder.apply((current) => ({ ...current, name: 'Edited' }), 'Edit', [
          'model',
        ]),
      );
      if (graph === 'matching')
        expect(hook.result.current.builder.lastChange?.affectedKinds.length).toBeGreaterThan(0);
      else expect(hook.result.current.builder.lastChange).toBeNull();
      hook.unmount();
      client.clear();
    },
  );

  it('conservatively rechecks mode-dependent edges when the pinned catalog is unavailable', async () => {
    const build = apiChat();
    build.locks.catalog_snapshot_id = 'catalog.unavailable';
    const providers = createFixtureProviders({ now: () => NOW });
    vi.spyOn(providers.builds, 'get').mockResolvedValue(createDraft(build));
    vi.spyOn(providers.builds, 'save').mockImplementation(async (draft) => draft);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <DataContext.Provider value={providers}>
        <QueryClientProvider client={client}>
          <BuilderProvider>{children}</BuilderProvider>
        </QueryClientProvider>
      </DataContext.Provider>
    );
    const hook = renderHook(() => ({ builder: useBuilder(), graph: useGraph() }), { wrapper });
    await waitFor(() =>
      expect(hook.result.current.builder.ready && hook.result.current.graph.isSuccess).toBe(true),
    );
    await act(async () => {
      await hook.result.current.builder.open(build.id);
    });
    act(() =>
      hook.result.current.builder.apply((current) => ({ ...current, name: 'Edited' }), 'Edit', [
        'context_policy',
      ]),
    );
    expect(
      hook.result.current.builder.lastChange?.via.some((edge) => edge.activation === 'self_hosted'),
    ).toBe(true);
    hook.unmount();
    client.clear();
  });
});
