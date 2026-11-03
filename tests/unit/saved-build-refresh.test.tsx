import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, MemoryRouter, RouterProvider } from 'react-router';
import { expect, it, vi } from 'vitest';
import { useBuilder } from '../../src/app/builder-context';
import { DataContext } from '../../src/app/data-context';
import { createFixtureProviders } from '../../src/data/fixture/providers';
import { createDraft } from '../../src/domain/build';
import MyBuildsPage from '../../src/pages/MyBuildsPage';
import { NOW, apiChat } from './scenarios';

vi.mock('../../src/app/builder-context', () => ({ useBuilder: vi.fn() }));

it('refreshes the library after an in-flight save completes', async () => {
  const draft = createDraft(apiChat());
  const providers = createFixtureProviders({ now: () => NOW });
  let persisted = false;
  let persistedDraft = draft;
  vi.spyOn(providers.builds, 'list').mockImplementation(async () =>
    persisted
      ? [
          {
            id: persistedDraft.build.id,
            name: persistedDraft.build.name,
            revision: persistedDraft.build.revision,
            updatedAt: persistedDraft.build.updated_at,
            selectionCount: persistedDraft.build.selections.length,
          },
        ]
      : [],
  );
  vi.spyOn(providers.builds, 'get').mockImplementation(async () => persistedDraft);
  const builder = {
    draft,
    ready: true,
    catalogById: new Map(),
    lastChange: null,
    apply: vi.fn(),
    startNew: vi.fn(),
    open: vi.fn(),
    restore: vi.fn(),
  };
  vi.mocked(useBuilder).mockReturnValue({ ...builder, saveState: { status: 'saving' } });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const tree = () => (
    <QueryClientProvider client={client}>
      <DataContext.Provider value={providers}>
        <MemoryRouter>
          <MyBuildsPage />
        </MemoryRouter>
      </DataContext.Provider>
    </QueryClientProvider>
  );
  const view = render(tree());
  await screen.findByText('No saved configurations yet');
  await waitFor(() => expect(client.isFetching()).toBe(0));

  persisted = true;
  vi.mocked(useBuilder).mockReturnValue({ ...builder, saveState: { status: 'saved' } });
  view.rerender(tree());

  const card = await screen.findByRole('article');
  expect(within(card).getByRole('heading', { name: /\(current\)/ })).toBeVisible();

  // A fast save may batch away the intermediate saving state. A new saved-state object still
  // represents a completed write and must refresh the list, even for the same build ID.
  persistedDraft = {
    ...draft,
    build: { ...draft.build, name: 'Updated build', revision: draft.build.revision + 1 },
  };
  vi.mocked(useBuilder).mockReturnValue({
    ...builder,
    draft: persistedDraft,
    saveState: { status: 'saved' },
  });
  view.rerender(tree());
  expect(await within(card).findByRole('heading', { name: /Updated build/ })).toBeVisible();
  view.unmount();
  client.clear();
});

it('cancels a pending open when the user leaves My Builds', async () => {
  const draft = createDraft(apiChat());
  const providers = createFixtureProviders({ now: () => NOW });
  vi.spyOn(providers.builds, 'list').mockResolvedValue([
    {
      id: draft.build.id,
      name: draft.build.name,
      revision: draft.build.revision,
      updatedAt: draft.build.updated_at,
      selectionCount: draft.build.selections.length,
    },
  ]);
  vi.spyOn(providers.builds, 'get').mockResolvedValue(draft);
  let signal: AbortSignal | undefined;
  let finish: ((value: boolean) => void) | undefined;
  const open = vi.fn((_id: string, requestSignal?: AbortSignal) => {
    signal = requestSignal;
    return new Promise<boolean>((resolve) => (finish = resolve));
  });
  vi.mocked(useBuilder).mockReturnValue({
    draft,
    ready: true,
    catalogById: new Map(),
    lastChange: null,
    saveState: { status: 'saved' },
    apply: vi.fn(),
    startNew: vi.fn(),
    open,
    restore: vi.fn(),
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const router = createMemoryRouter(
    [
      { path: '/builds', element: <MyBuildsPage /> },
      { path: '/about', element: <h1>About</h1> },
      { path: '/builder', element: <h1>Builder</h1> },
    ],
    { initialEntries: ['/builds'] },
  );
  const view = render(
    <QueryClientProvider client={client}>
      <DataContext.Provider value={providers}>
        <RouterProvider router={router} />
      </DataContext.Provider>
    </QueryClientProvider>,
  );
  const card = await screen.findByRole('article');
  fireEvent.click(within(card).getByRole('button', { name: /Open build/ }));
  expect(signal?.aborted).toBe(false);
  await act(async () => router.navigate('/about'));
  expect(signal?.aborted).toBe(true);
  await act(async () => finish?.(true));
  expect(router.state.location.pathname).toBe('/about');
  view.unmount();
  client.clear();
});
