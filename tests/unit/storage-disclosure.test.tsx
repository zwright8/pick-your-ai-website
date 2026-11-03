import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { expect, it, vi } from 'vitest';
import { useBuilder } from '../../src/app/builder-context';
import { DataContext } from '../../src/app/data-context';
import { DemoBanner } from '../../src/components/layout';
import { createProviders } from '../../src/data/config';
import { createFixtureProviders } from '../../src/data/fixture/providers';
import { createDraft } from '../../src/domain/build';
import AboutPage from '../../src/pages/AboutPage';
import LegalPage from '../../src/pages/LegalPage';
import MyBuildsPage from '../../src/pages/MyBuildsPage';
import { apiChat, BY_ID, NOW } from './scenarios';

vi.mock('../../src/app/builder-context', () => ({ useBuilder: vi.fn() }));

it('exposes the actual configured build store independently of data mode', () => {
  const env = {
    VITE_DATA_MODE: 'http',
    VITE_API_BASE_URL: 'https://api.test/v1',
    VITE_CATALOG_SNAPSHOT: 'catalog.test',
  };
  expect(createProviders({}).buildStore).toBe('local');
  expect(createProviders(env).buildStore).toBe('local');
  expect(createProviders({ ...env, VITE_BUILD_STORE: 'http' }).buildStore).toBe('http');
});

for (const [mode, store] of [
  ['fixture', 'local'],
  ['http', 'local'],
  ['http', 'http'],
] as const) {
  it(`describes ${mode} data with ${store} build storage`, async () => {
    localStorage.clear();
    const build = apiChat();
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
    const providers = createFixtureProviders({ now: () => NOW });
    providers.mode = mode;
    providers.buildStore = store;
    await providers.builds.save(createDraft(build), null);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const router = createMemoryRouter(
      [
        {
          path: '/legal',
          element: (
            <>
              <DemoBanner />
              <LegalPage />
            </>
          ),
        },
        { path: '/about', element: <AboutPage /> },
        { path: '/builds', element: <MyBuildsPage /> },
      ],
      { initialEntries: ['/legal'] },
    );
    const view = render(
      <QueryClientProvider client={client}>
        <DataContext.Provider value={providers}>
          <RouterProvider router={router} />
        </DataContext.Provider>
      </QueryClientProvider>,
    );
    if (mode === 'fixture') {
      expect(screen.getByText(/Build snapshots are saved in this browser/)).toBeInTheDocument();
      expect(
        screen.queryByText(/configured API receives build identifiers/),
      ).not.toBeInTheDocument();
    } else {
      const banner = screen.getByRole('note', { name: 'Data source' });
      expect(banner).toHaveTextContent(
        store === 'http'
          ? 'Build snapshots and analysis requests are sent'
          : 'Analysis requests include build identifiers and revisions',
      );
      const privacy = screen.getByRole('heading', { name: 'Privacy' }).closest('section');
      if (!privacy) throw new Error('Missing privacy section');
      expect(privacy).toHaveTextContent('configured API receives build identifiers and revisions');
      expect(screen.getByText(/shared build’s identifier and revision/)).toBeInTheDocument();
    }
    if (store === 'http')
      expect(
        screen.getByText(/Build snapshots are sent to the configured API/),
      ).toBeInTheDocument();
    await act(async () => router.navigate('/about'));
    if (store === 'http')
      expect(screen.getByText(/saved through the configured API/)).toBeInTheDocument();
    else expect(screen.getByText(/saved in this browser/)).toBeInTheDocument();
    await act(async () => router.navigate('/builds'));
    const card = await screen.findByRole('article');
    if (store === 'http') {
      expect(screen.getByText(/Removing a build here does not delete its API copy/)).toBeVisible();
      fireEvent.click(within(card).getByRole('button', { name: /Remove .* from library/ }));
      expect(within(card).getByRole('group', { name: 'Confirm removal' })).toHaveTextContent(
        'The API copy is not deleted',
      );
    } else {
      expect(screen.getByText(/Your saved configurations live in this browser/)).toBeVisible();
    }
    view.unmount();
    client.clear();
  });
}
