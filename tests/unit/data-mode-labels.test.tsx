import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, Route, RouterProvider, Routes } from 'react-router';
import { expect, it, vi } from 'vitest';
import { useBuilder } from '../../src/app/builder-context';
import { DataContext } from '../../src/app/data-context';
import { ToastProvider } from '../../src/components/feedback';
import { Layout } from '../../src/components/layout';
import { createFixtureProviders } from '../../src/data/fixture/providers';
import { createDraft } from '../../src/domain/build';
import BuilderPage from '../../src/features/builder/BuilderPage';
import { BuilderLoading } from '../../src/features/builder/BuilderLoading';
import ComponentDetailPage from '../../src/features/catalog/ComponentDetailPage';
import { PartList } from '../../src/features/catalog/PartList';
import ComparePage from '../../src/pages/ComparePage';
import MyBuildsPage from '../../src/pages/MyBuildsPage';
import HomePage from '../../src/pages/HomePage';
import { apiChat, BY_ID, CATALOG, NOW } from './scenarios';

vi.mock('../../src/app/builder-context', () => ({ useBuilder: vi.fn() }));

it.each(['fixture', 'http'] as const)(
  'uses %s data labels in the builder loading state',
  (mode) => {
    const providers = createFixtureProviders({ now: () => NOW });
    providers.mode = mode;
    const router = createMemoryRouter([{ path: '*', element: <BuilderLoading /> }]);
    const view = render(
      <DataContext.Provider value={providers}>
        <RouterProvider router={router} />
      </DataContext.Provider>,
    );
    const description = screen.getByText(/One row per component slot/);
    expect(description).toHaveTextContent(
      mode === 'fixture' ? 'synthetic demo data' : 'Prices are estimates',
    );
    if (mode === 'http') expect(description).not.toHaveTextContent('synthetic demo data');
    view.unmount();
  },
);

async function show(
  page:
    'builder' | 'catalog' | 'detail' | 'compare' | 'compare-builds' | 'library' | 'home' | 'layout',
  mode: 'fixture' | 'http',
  drifted = false,
  nonSynthetic: boolean | 'mixed' = false,
) {
  localStorage.clear();
  const build = apiChat();
  if (drifted) {
    const model = build.selections.find((selection) => selection.kind === 'model');
    if (!model) throw new Error('Missing model');
    model.catalog_item_version = 'older-version';
  }
  const first = { ...build, revision: 1 };
  const second = { ...build, revision: 2 };
  vi.mocked(useBuilder).mockReturnValue({
    draft: { ...createDraft(second), revisions: [first, second] },
    ready: true,
    catalogById: BY_ID,
    lastChange: null,
    saveState: { status: 'saved' },
    apply: vi.fn(),
    startNew: vi.fn(),
    open: vi.fn(),
    restore: vi.fn(),
  });
  const catalog = nonSynthetic
    ? {
        ...CATALOG,
        items: CATALOG.items.map((item) => ({
          ...item,
          tags: (item.tags ?? []).filter(
            (tag) =>
              tag !== 'synthetic' ||
              (nonSynthetic === 'mixed' && item.id === 'demo.model.aurora-large'),
          ),
        })),
      }
    : CATALOG;
  const providers = createFixtureProviders({ now: () => NOW, catalog });
  providers.mode = mode;
  if (page === 'library') await providers.builds.save(createDraft(build), null);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const path =
    page === 'detail'
      ? '/catalog/model/demo~model~aurora-mini'
      : page === 'compare-builds'
        ? '/compare?revisions=1,2'
        : page === 'compare'
          ? '/compare'
          : '/';
  const element =
    page === 'home' ? (
      <HomePage />
    ) : page === 'layout' ? (
      <Layout />
    ) : page === 'builder' ? (
      <BuilderPage />
    ) : page === 'catalog' ? (
      <PartList mode="kind" kind="model" />
    ) : page === 'detail' ? (
      <Routes>
        <Route path="/catalog/:kindSlug/:itemSlug" element={<ComponentDetailPage />} />
      </Routes>
    ) : page === 'library' ? (
      <MyBuildsPage />
    ) : (
      <ComparePage />
    );
  const router = createMemoryRouter(
    [{ path: '*', element: <ToastProvider>{element}</ToastProvider> }],
    {
      initialEntries: [path],
    },
  );
  const view = render(
    <QueryClientProvider client={client}>
      <DataContext.Provider value={providers}>
        <RouterProvider router={router} />
      </DataContext.Provider>
    </QueryClientProvider>,
  );
  return { ...view, client };
}

it('uses neutral builder copy in HTTP mode and retains demo copy in fixture mode', async () => {
  const http = await show('builder', 'http');
  await waitFor(() =>
    expect(screen.getByText(/Prices are estimates and compatibility/)).toBeVisible(),
  );
  expect(screen.queryByText(/synthetic demo pricebook/i)).not.toBeInTheDocument();
  const model = await screen.findByRole('row', { name: /AI Model.*Demo Aurora Large/i });
  expect(within(model).getByText('Synthetic', { exact: true })).toBeVisible();
  http.unmount();
  http.client.clear();
  const fixture = await show('builder', 'fixture');
  await waitFor(() => expect(screen.getByText(/synthetic demo pricebook/i)).toBeVisible());
  expect(screen.getByText(/synthetic demo data/)).toBeVisible();
  fixture.unmount();
  fixture.client.clear();
});

it.each(['fixture', 'http'] as const)(
  'shows accurate global and home labels in %s mode',
  async (mode) => {
    const layout = await show('layout', mode);
    const banner = screen.getByRole('note', {
      name: mode === 'fixture' ? 'Demo mode' : 'Data source',
    });
    const footer = screen.getByRole('contentinfo');
    if (mode === 'fixture') {
      expect(banner).toHaveTextContent('synthetic illustrative demo data');
      expect(footer).toHaveTextContent('NO LIVE CATALOG');
    } else {
      expect(banner).toHaveTextContent('configured API');
      expect(banner).not.toHaveTextContent('use synthetic illustrative demo data');
      expect(footer).toHaveTextContent('CATALOG FROM CONFIGURED API');
      expect(footer).not.toHaveTextContent('NO LIVE CATALOG');
    }
    layout.unmount();
    layout.client.clear();
    const home = await show('home', mode);
    expect(await screen.findByText(/07 LAYERS/)).toHaveTextContent(
      mode === 'fixture' ? 'DEMO CATALOG' : 'CATALOG',
    );
    if (mode === 'http') expect(screen.queryByText('DEMO CATALOG')).not.toBeInTheDocument();
    if (mode === 'http') {
      expect(screen.getByRole('link', { name: /Browse components/ })).toHaveAttribute(
        'href',
        '/catalog',
      );
      expect(
        screen.queryByRole('link', { name: /Explore starter builds/ }),
      ).not.toBeInTheDocument();
    }
    home.unmount();
    home.client.clear();
  },
);

it('attributes a synthetic tag to the current catalog record when the selected version differs', async () => {
  const view = await show('builder', 'http', true);
  const row = await screen.findByRole('row', { name: /AI Model.*Demo Aurora Large/i });
  expect(row).toHaveTextContent('Current catalog record is synthetic');
  expect(within(row).queryByText('Synthetic', { exact: true })).not.toBeInTheDocument();
  view.unmount();
  view.client.clear();
});

it('does not describe the HTTP catalog as a demo', async () => {
  const view = await show('catalog', 'http');
  expect(
    await screen.findByRole('caption', { name: /components.*AI Model/i }),
  ).not.toHaveTextContent('synthetic demo catalog');
  expect(screen.getByText(/Estimates · not a quote/)).toBeVisible();
  const model = await screen.findByRole('row', { name: /Demo Aurora Mini/i });
  expect(within(model).getByText('Synthetic', { exact: true })).toBeVisible();
  expect(
    screen.queryByText('Estimates are synthetic demo data, not quotes.'),
  ).not.toBeInTheDocument();
  view.unmount();
  view.client.clear();
});

it('uses neutral compatibility and availability wording on HTTP component details', async () => {
  const view = await show('detail', 'http', false, true);
  expect(await screen.findByText('Compatibility', { selector: 'span' })).toBeVisible();
  expect(screen.queryByText('Demo compatibility')).not.toBeInTheDocument();
  expect(
    screen.queryByText(/demo rules|demo conflict|demo rate|demo catalog/i),
  ).not.toBeInTheDocument();
  expect(screen.queryByText('Preview data only.')).not.toBeInTheDocument();
  expect(screen.getAllByText('No licence declared in this record').length).toBeGreaterThan(0);
  view.unmount();
  view.client.clear();
});

it('uses neutral component and build-comparison wording in HTTP mode', async () => {
  const parts = await show('compare', 'http');
  expect(await screen.findByText(/Rows marked ≠ differ/)).not.toHaveTextContent(
    'synthetic demo data',
  );
  expect(screen.getAllByText('Synthetic', { exact: true }).length).toBeGreaterThan(0);
  const syntheticNotice = screen.getByText('Synthetic catalog records in this comparison:');
  expect(syntheticNotice).toBeVisible();
  expect(syntheticNotice.parentElement).toHaveTextContent('Slot 1:');
  parts.unmount();
  parts.client.clear();
  const builds = await show('compare-builds', 'http');
  const cost = await screen.findByRole('region', { name: 'Estimated cost' });
  expect(await within(cost).findByText(/not a quote/i)).not.toHaveTextContent(
    'Synthetic demo prices',
  );
  expect(cost).not.toHaveTextContent('Synthetic estimate with complete coverage');
  builds.unmount();
  builds.client.clear();
});

it('identifies only the synthetic slot in a mixed HTTP comparison', async () => {
  const view = await show('compare', 'http', false, 'mixed');
  const notice = await screen.findByText('Synthetic catalog records in this comparison:');
  expect(notice.parentElement).toHaveTextContent('Slot 1: Demo Aurora Large');
  expect(notice.parentElement).not.toHaveTextContent('Slot 2:');
  expect(notice.parentElement).not.toHaveTextContent('Slot 3:');
  view.unmount();
  view.client.clear();
});

it('uses a neutral validation label for saved builds in HTTP mode', async () => {
  const view = await show('library', 'http');
  const card = await screen.findByRole('article');
  expect(within(card).getByText('VALIDATION', { exact: true })).toBeVisible();
  expect(within(card).queryByText('DEMO VALIDATION')).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Browse components/ })).toHaveAttribute(
    'href',
    '/catalog',
  );
  expect(screen.queryByRole('link', { name: /View starter builds/ })).not.toBeInTheDocument();
  view.unmount();
  view.client.clear();
});

it('retains demo labels across fixture catalog, detail, comparisons and library', async () => {
  const catalog = await show('catalog', 'fixture');
  expect(await screen.findByRole('caption', { name: /synthetic demo catalog/i })).toBeVisible();
  expect(screen.getByText(/Synthetic demo estimates · not a quote/)).toBeVisible();
  catalog.unmount();
  catalog.client.clear();
  const detail = await show('detail', 'fixture');
  expect(await screen.findByText('Demo compatibility')).toBeVisible();
  detail.unmount();
  detail.client.clear();
  const parts = await show('compare', 'fixture');
  expect(await screen.findByText(/Rows marked ≠ differ/)).toHaveTextContent('synthetic demo data');
  parts.unmount();
  parts.client.clear();
  const builds = await show('compare-builds', 'fixture');
  const cost = await screen.findByRole('region', { name: 'Estimated cost' });
  expect(await within(cost).findByText(/Synthetic demo prices — not a quote/)).toBeVisible();
  builds.unmount();
  builds.client.clear();
  const library = await show('library', 'fixture');
  expect(within(await screen.findByRole('article')).getByText('DEMO VALIDATION')).toBeVisible();
  library.unmount();
  library.client.clear();
});
