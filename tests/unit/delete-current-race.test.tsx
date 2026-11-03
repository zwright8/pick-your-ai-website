import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { expect, it, vi } from 'vitest';
import { BuilderProvider, useBuilder } from '../../src/app/builder-context';
import { DataContext } from '../../src/app/data-context';
import { createFixtureProviders } from '../../src/data/fixture/providers';
import { createDraft } from '../../src/domain/build';
import MyBuildsPage from '../../src/pages/MyBuildsPage';
import { NOW, apiChat } from './scenarios';

it('does not replace a newer working build when an earlier delete finishes', async () => {
  localStorage.clear();
  const providers = createFixtureProviders({ now: () => NOW });
  const original = createDraft(apiChat());
  await providers.builds.save(original, null);
  localStorage.setItem('pyai.currentBuildId', original.build.id);
  const remove = providers.builds.remove.bind(providers.builds);
  let release: (() => void) | undefined;
  let deletionDone: (() => void) | undefined;
  const finished = new Promise<void>((resolve) => (deletionDone = resolve));
  vi.spyOn(providers.builds, 'remove').mockImplementation(async (id) => {
    await new Promise<void>((resolve) => (release = resolve));
    await remove(id);
    deletionDone!();
  });
  let builder: ReturnType<typeof useBuilder>;
  function Probe() {
    builder = useBuilder();
    return null;
  }
  const router = createMemoryRouter(
    [
      {
        path: '/builds',
        element: (
          <>
            <Probe />
            <MyBuildsPage />
          </>
        ),
      },
    ],
    { initialEntries: ['/builds'] },
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const view = render(
    <DataContext.Provider value={providers}>
      <QueryClientProvider client={client}>
        <BuilderProvider>
          <RouterProvider router={router} />
        </BuilderProvider>
      </QueryClientProvider>
    </DataContext.Provider>,
  );
  await waitFor(() => expect(builder?.draft?.build.id).toBe(original.build.id));
  const card = await screen.findByRole('article');
  fireEvent.click(within(card).getByRole('button', { name: /Delete / }));
  fireEvent.click(within(card).getByRole('button', { name: 'Yes, delete' }));
  await waitFor(() => expect(release).toBeDefined());
  act(() => builder!.startNew(undefined, 'Newer draft'));
  await waitFor(() => expect(builder!.draft?.build.name).toBe('Newer draft'));
  const newId = builder!.draft!.build.id;
  await act(async () => {
    release!();
    await finished;
  });
  expect(builder!.draft?.build.id).toBe(newId);
  expect(builder!.draft?.build.name).toBe('Newer draft');
  view.unmount();
  client.clear();
});

it('keeps later edits to the deleted build visible and marks them unsaved', async () => {
  localStorage.clear();
  const providers = createFixtureProviders({ now: () => NOW });
  const original = createDraft(apiChat());
  await providers.builds.save(original, null);
  localStorage.setItem('pyai.currentBuildId', original.build.id);
  const remove = providers.builds.remove.bind(providers.builds);
  let release: (() => void) | undefined;
  let deletionDone: (() => void) | undefined;
  const finished = new Promise<void>((resolve) => (deletionDone = resolve));
  vi.spyOn(providers.builds, 'remove').mockImplementation(async (id) => {
    await new Promise<void>((resolve) => (release = resolve));
    await remove(id);
    deletionDone!();
  });
  let builder: ReturnType<typeof useBuilder>;
  function Probe() {
    builder = useBuilder();
    return null;
  }
  const router = createMemoryRouter(
    [
      {
        path: '/builds',
        element: (
          <>
            <Probe />
            <MyBuildsPage />
          </>
        ),
      },
    ],
    { initialEntries: ['/builds'] },
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const view = render(
    <DataContext.Provider value={providers}>
      <QueryClientProvider client={client}>
        <BuilderProvider>
          <RouterProvider router={router} />
        </BuilderProvider>
      </QueryClientProvider>
    </DataContext.Provider>,
  );
  await waitFor(() => expect(builder?.draft?.build.id).toBe(original.build.id));
  const card = await screen.findByRole('article');
  fireEvent.click(within(card).getByRole('button', { name: /Delete / }));
  fireEvent.click(within(card).getByRole('button', { name: 'Yes, delete' }));
  await waitFor(() => expect(release).toBeDefined());
  act(() => builder!.apply((build) => ({ ...build, name: 'Edited during delete' }), 'Edit', []));
  await waitFor(() => expect(builder!.saveState.status).toBe('saved'));
  await act(async () => {
    release!();
    await finished;
  });
  expect(builder!.draft?.build.name).toBe('Edited during delete');
  expect(builder!.saveState).toMatchObject({ status: 'error', unsaved: true });
  expect(window.dispatchEvent(new Event('beforeunload', { cancelable: true }))).toBe(false);
  view.unmount();
  client.clear();
});

it.each([true, false])(
  'preserves an in-flight open when deletion completes (open succeeds: %s)',
  async (succeeds) => {
    localStorage.clear();
    const providers = createFixtureProviders({ now: () => NOW });
    const original = createDraft(apiChat());
    const other = createDraft({ ...apiChat(), id: 'build.other', name: 'Other build' });
    await providers.builds.save(original, null);
    await providers.builds.save(other, null);
    localStorage.setItem('pyai.currentBuildId', original.build.id);
    let releaseDelete!: () => void;
    let releaseOpen!: () => void;
    const deleteGate = new Promise<void>((resolve) => (releaseDelete = resolve));
    const openGate = new Promise<void>((resolve) => (releaseOpen = resolve));
    const remove = providers.builds.remove.bind(providers.builds);
    vi.spyOn(providers.builds, 'remove').mockImplementation(async (id, token) => {
      await deleteGate;
      await remove(id, token);
    });
    let builder: ReturnType<typeof useBuilder>;
    function Probe() {
      builder = useBuilder();
      return null;
    }
    const router = createMemoryRouter(
      [
        {
          path: '/builds',
          element: (
            <>
              <Probe />
              <MyBuildsPage />
            </>
          ),
        },
      ],
      { initialEntries: ['/builds'] },
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const view = render(
      <DataContext.Provider value={providers}>
        <QueryClientProvider client={client}>
          <BuilderProvider>
            <RouterProvider router={router} />
          </BuilderProvider>
        </QueryClientProvider>
      </DataContext.Provider>,
    );
    await waitFor(() => expect(builder?.draft?.build.id).toBe(original.build.id));
    const card = (await screen.findAllByRole('article')).find((item) =>
      within(item).queryByRole('button', { name: `Delete ${original.build.name}` }),
    )!;
    fireEvent.click(within(card).getByRole('button', { name: /Delete / }));
    fireEvent.click(within(card).getByRole('button', { name: 'Yes, delete' }));
    const get = providers.builds.get.bind(providers.builds);
    vi.spyOn(providers.builds, 'get').mockImplementation(async (id) => {
      if (id === other.build.id) {
        await openGate;
        if (!succeeds) throw new Error('Open failed');
      }
      return get(id);
    });
    let opened!: Promise<boolean>;
    act(() => {
      opened = builder!.open(other.build.id);
    });
    await act(async () => {
      releaseDelete();
    });
    await waitFor(() =>
      expect(builder!.saveState).toMatchObject({ status: 'error', unsaved: true }),
    );
    expect(builder!.draft?.build.id).toBe(original.build.id);
    await act(async () => {
      releaseOpen();
      if (succeeds) expect(await opened).toBe(true);
      else await expect(opened).rejects.toThrow('Open failed');
    });
    expect(builder!.draft?.build.id).toBe(succeeds ? other.build.id : original.build.id);
    if (!succeeds) {
      act(() => builder!.apply((build) => ({ ...build, name: 'Kept editing' }), 'Edit', []));
      expect(builder!.draft?.build.name).toBe('Kept editing');
      expect(builder!.saveState).toMatchObject({ status: 'error', unsaved: true });
      expect(window.dispatchEvent(new Event('beforeunload', { cancelable: true }))).toBe(false);
    }
    view.unmount();
    client.clear();
  },
);
