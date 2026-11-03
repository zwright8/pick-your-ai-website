import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { useBuilder } from '../../src/app/builder-context';
import { DataContext } from '../../src/app/data-context';
import { ToastProvider } from '../../src/components/feedback';
import { createFixtureProviders } from '../../src/data/fixture/providers';
import { createDraft } from '../../src/domain/build';
import BuilderPage from '../../src/features/builder/BuilderPage';
import ComponentDetailPage from '../../src/features/catalog/ComponentDetailPage';
import { PartList } from '../../src/features/catalog/PartList';
import ComparePage from '../../src/pages/ComparePage';
import { apiChat, BY_ID, item, NOW } from './scenarios';

vi.mock('../../src/app/builder-context', () => ({ useBuilder: vi.fn() }));
vi.mock('react-router', async (original) => ({
  ...(await original<typeof import('react-router')>()),
  useBlocker: () => ({ state: 'unblocked' }),
}));

describe('catalog snapshot admission', () => {
  it('does not label catalog components required for an unavailable ruleset', async () => {
    const build = apiChat();
    build.locks.ruleset_id = 'ruleset.unavailable';
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
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const view = render(
      <QueryClientProvider client={client}>
        <DataContext.Provider value={providers}>
          <MemoryRouter initialEntries={['/catalog?show=all']}>
            <ToastProvider>
              <PartList mode="all" />
            </ToastProvider>
          </MemoryRouter>
        </DataContext.Provider>
      </QueryClientProvider>,
    );
    await waitFor(() =>
      expect(client.getQueryState(['catalog', 'ruleset'])?.status).toBe('success'),
    );
    const row = await screen.findByRole('row', { name: /Demo Aurora Large/ });
    const kindCell = row.querySelector('[data-label="Kind"]');
    if (!kindCell) throw new Error('Missing kind cell');
    expect(kindCell).not.toHaveTextContent('required');
    const context = screen.getByLabelText('Build context and filters');
    expect(within(context).getByText('Required').parentElement).toHaveTextContent('Not evaluated');
    view.unmount();
    client.clear();
  });

  it('does not claim required components for an incomplete build with an unavailable ruleset', async () => {
    const build = apiChat();
    build.selections = build.selections.filter((selection) => selection.kind !== 'model');
    build.locks.ruleset_id = 'ruleset.unavailable';
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
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const view = render(
      <QueryClientProvider client={client}>
        <DataContext.Provider value={providers}>
          <MemoryRouter>
            <ToastProvider>
              <BuilderPage />
            </ToastProvider>
          </MemoryRouter>
        </DataContext.Provider>
      </QueryClientProvider>,
    );
    await waitFor(() =>
      expect(client.getQueryState(['catalog', 'ruleset'])?.status).toBe('success'),
    );
    const status = screen.getByTestId('overall-status');
    expect(status).toHaveTextContent('Not evaluated yet');
    expect(status).not.toHaveTextContent(/required components? missing/i);
    expect(screen.getAllByText('Requirements not evaluated').length).toBeGreaterThan(0);
    expect(screen.queryByText(/Required \d+\/\d+/)).toBeNull();
    view.unmount();
    client.clear();
  });

  it.each([
    '/builder',
    '/catalog/model?show=all',
    '/catalog/model/demo~model~aurora-large',
    '/compare?ids=demo~model~aurora-large',
  ])(
    'does not show prices or positive candidate verdicts from another snapshot on %s',
    async (path) => {
      const build = apiChat();
      build.locks.catalog_snapshot_id = 'catalog.unavailable';
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
      const model = item('model', 'aurora-large');
      const options = vi.spyOn(providers.compatibility, 'compatibleOptions').mockResolvedValue([
        {
          catalog_item_id: model.id,
          catalog_item_version: model.version,
          verdict: 'compatible',
          rule_ids: [],
        },
      ]);
      const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
      const view = render(
        <QueryClientProvider client={client}>
          <DataContext.Provider value={providers}>
            <MemoryRouter initialEntries={[path]}>
              <ToastProvider>
                <Routes>
                  <Route path="/builder" element={<BuilderPage />} />
                  <Route path="/catalog/model" element={<PartList mode="kind" kind="model" />} />
                  <Route path="/catalog/:kindSlug/:itemSlug" element={<ComponentDetailPage />} />
                  <Route path="/compare" element={<ComparePage />} />
                </Routes>
              </ToastProvider>
            </MemoryRouter>
          </DataContext.Provider>
        </QueryClientProvider>,
      );
      await screen.findAllByText('Demo Aurora Large');
      expect(screen.queryByText('$324')).not.toBeInTheDocument();
      if (path !== '/builder') {
        await waitFor(() => {
          expect(options).toHaveBeenCalled();
          const queries = client
            .getQueryCache()
            .getAll()
            .filter((query) => ['options', 'compat-kind'].includes(String(query.queryKey[0])));
          expect(queries.some((query) => query.state.status === 'success')).toBe(true);
        });
      }
      if (path.startsWith('/catalog/model?')) {
        const row = screen.getByRole('row', { name: /Demo Aurora Large/ });
        const cell = row.querySelector<HTMLElement>('[data-label="Compatibility"]');
        if (!cell) throw new Error('Missing compatibility cell');
        expect(within(cell).getByText('Unknown')).toBeVisible();
      } else if (path.startsWith('/catalog/model/')) {
        expect(await screen.findByText(/Unknown — the demo rules cannot decide/)).toBeVisible();
      } else if (path.startsWith('/compare')) {
        const fit = screen.getByRole('row', { name: /Fits your stack/ });
        expect(within(fit).getByText('Unknown')).toBeVisible();
      }
      view.unmount();
      client.clear();
    },
  );
});
