import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { expect, it, vi } from 'vitest';
import { BuilderProvider, useBuilder } from '../../src/app/builder-context';
import { DataContext } from '../../src/app/data-context';
import { createFixtureProviders } from '../../src/data/fixture/providers';
import { NOW, apiChat } from './scenarios';

it('keeps a requested build pending through catalog failure and retry', async () => {
  localStorage.clear();
  const providers = createFixtureProviders({ now: () => NOW });
  const snapshot = await providers.catalog.getSnapshot();
  let failFirst: ((error: Error) => void) | undefined;
  const getSnapshot = vi
    .spyOn(providers.catalog, 'getSnapshot')
    .mockImplementationOnce(() => new Promise((_resolve, reject) => (failFirst = reject)))
    .mockResolvedValue(snapshot);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <DataContext.Provider value={providers}>
      <QueryClientProvider client={client}>
        <BuilderProvider>{children}</BuilderProvider>
      </QueryClientProvider>
    </DataContext.Provider>
  );
  const hook = renderHook(() => useBuilder(), { wrapper });
  await waitFor(() => expect(failFirst).toBeDefined());
  const template = apiChat();
  act(() => {
    hook.result.current.startNew(undefined, 'Superseded build');
    hook.result.current.startNew(template, 'Requested build');
  });
  expect(getSnapshot).toHaveBeenCalledTimes(1);
  await act(async () => failFirst!(new Error('Catalog unavailable')));
  await waitFor(() => expect(client.getQueryState(['catalog', 'snapshot'])?.status).toBe('error'));
  await act(async () => client.refetchQueries({ queryKey: ['catalog', 'snapshot'] }));
  await waitFor(() => expect(hook.result.current.draft?.build.name).toBe('Requested build'));
  expect(hook.result.current.draft?.build.selections).toEqual(template.selections);
  await waitFor(() => expect(hook.result.current.saveState.status).toBe('saved'));
  hook.unmount();
  client.clear();
});

it('starts a pending choice if the catalog resolved after the handler was captured', async () => {
  localStorage.clear();
  const providers = createFixtureProviders({ now: () => NOW });
  const snapshot = await providers.catalog.getSnapshot();
  let release: ((value: typeof snapshot) => void) | undefined;
  vi.spyOn(providers.catalog, 'getSnapshot').mockImplementation(
    () => new Promise((resolve) => (release = resolve)),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <DataContext.Provider value={providers}>
      <QueryClientProvider client={client}>
        <BuilderProvider>{children}</BuilderProvider>
      </QueryClientProvider>
    </DataContext.Provider>
  );
  const hook = renderHook(() => useBuilder(), { wrapper });
  await waitFor(() => expect(release).toBeDefined());
  const earlierHandler = hook.result.current.startNew;
  await act(async () => release!(snapshot));
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  act(() => earlierHandler(undefined, 'Delayed choice'));
  await waitFor(() => expect(hook.result.current.draft?.build.name).toBe('Delayed choice'));
  hook.unmount();
  client.clear();
});
