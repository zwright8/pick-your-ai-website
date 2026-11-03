import { render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { DataContext } from '../../src/app/data-context';
import { useBuilder } from '../../src/app/builder-context';
import { validatorsReady } from '../../src/contracts';
import { createFixtureProviders } from '../../src/data/fixture/providers';
import { createDraft } from '../../src/domain/build';
import { encodeShareFragment } from '../../src/domain/share';
import BuildSummaryPage from '../../src/pages/BuildSummaryPage';
import SharedBuildPage from '../../src/pages/SharedBuildPage';
import { apiChat, BY_ID, CATALOG, NOW, item } from './scenarios';

vi.mock('../../src/app/builder-context', () => ({ useBuilder: vi.fn() }));

it.each(['summary', 'shared'] as const)(
  'shows both versions beside a drifted selection in %s',
  async (page) => {
    await validatorsReady;
    const build = apiChat();
    build.selections = build.selections.map((selection) =>
      selection.id === 'sel_model'
        ? { ...selection, catalog_item_version: 'older-version' }
        : selection,
    );
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
          <MemoryRouter initialEntries={[`/shared#${encodeShareFragment(build, 'fixture')}`]}>
            {page === 'summary' ? <BuildSummaryPage /> : <SharedBuildPage />}
          </MemoryRouter>
        </DataContext.Provider>
      </QueryClientProvider>,
    );
    const name = await screen.findByRole('link', { name: 'Demo Aurora Large' });
    const row = name.closest(page === 'summary' ? 'tr' : 'li');
    if (!row) throw new Error('Missing selection row');
    expect(row).toHaveTextContent('Selected version: older-version');
    expect(row).toHaveTextContent(
      `current catalog version: ${item('model', 'aurora-large').version}`,
    );
    expect(row).toHaveTextContent('Current catalog name:');
    expect(row).toHaveTextContent('Current catalog record is synthetic');
    expect(within(row).queryByText('Synthetic', { exact: true })).not.toBeInTheDocument();
    if (page === 'summary') {
      const cost = screen.getByRole('region', { name: 'Cost breakdown' });
      await waitFor(() =>
        expect(cost).toHaveTextContent('current catalog name; selected version: older-version'),
      );
    }
    view.unmount();
    client.clear();
  },
);

it.each(['summary', 'shared'] as const)(
  'does not present a different-kind catalog record as the selected model in %s',
  async (page) => {
    await validatorsReady;
    const build = apiChat();
    const model = build.selections.find((selection) => selection.kind === 'model');
    if (!model) throw new Error('Missing model selection');
    const wrong = {
      ...item('workload', 'support-chat'),
      id: model.catalog_item_id,
      version: model.catalog_item_version,
    };
    const catalog = {
      ...CATALOG,
      items: CATALOG.items.map((entry) => (entry.id === model.catalog_item_id ? wrong : entry)),
    };
    const providers = createFixtureProviders({ now: () => NOW, catalog });
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
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const view = render(
      <QueryClientProvider client={client}>
        <DataContext.Provider value={providers}>
          <MemoryRouter initialEntries={[`/shared#${encodeShareFragment(build, 'fixture')}`]}>
            {page === 'summary' ? <BuildSummaryPage /> : <SharedBuildPage />}
          </MemoryRouter>
        </DataContext.Provider>
      </QueryClientProvider>,
    );
    if (page === 'summary') {
      const row = await screen.findByRole('row', { name: /AI Model.*demo\.model\.aurora-large/ });
      expect(within(row).getByText('Not in this catalog')).toBeVisible();
      expect(row).not.toHaveTextContent('Demo Customer Support Chat');
    } else {
      const modelLabel = await screen.findByText('AI Model:');
      const row = modelLabel.closest('li');
      expect(row).toHaveTextContent('demo.model.aurora-large');
      expect(row).toHaveTextContent('Not in this catalog');
      expect(screen.getByText(/1 selection is not in this catalog/i)).toBeVisible();
    }
    view.unmount();
    client.clear();
  },
);

describe.each(['summary', 'shared'] as const)('%s evaluation presentation', (page) => {
  it.each(['pending', 'unavailable'] as const)('stays neutral when %s', async (state) => {
    await validatorsReady;
    const build = apiChat();
    const providers = createFixtureProviders({ now: () => NOW });
    vi.spyOn(providers.compatibility, 'evaluate').mockImplementation(() =>
      state === 'pending'
        ? new Promise(() => {})
        : Promise.reject(new Error('Evaluation unavailable')),
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, retryDelay: 0, gcTime: 0 } },
    });
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
    const view = render(
      <QueryClientProvider client={client}>
        <DataContext.Provider value={providers}>
          <MemoryRouter initialEntries={[`/shared#${encodeShareFragment(build, 'fixture')}`]}>
            {page === 'summary' ? <BuildSummaryPage /> : <SharedBuildPage />}
          </MemoryRouter>
        </DataContext.Provider>
      </QueryClientProvider>,
    );
    const panel = await screen.findByTestId('overall-status');
    await waitFor(() => expect(providers.compatibility.evaluate).toHaveBeenCalled());
    if (state === 'unavailable') await screen.findAllByText('Evaluation unavailable');
    expect(panel).toHaveClass('neutral');
    expect(panel).not.toHaveClass('warning', 'danger');
    expect(panel.querySelector('use')).toHaveAttribute('href', '#i-info');
    expect(panel).toHaveTextContent(
      page === 'summary'
        ? 'Not evaluated yet'
        : state === 'unavailable'
          ? 'Evaluation unavailable'
          : 'Evaluating this build',
    );
    if (page === 'summary') {
      expect(panel).toHaveTextContent(
        state === 'unavailable'
          ? 'The published rules could not be evaluated. Use the retry action below.'
          : 'The published rules are being evaluated for this revision.',
      );
    }
    const findings = screen.getByRole('region', { name: 'Findings' });
    if (state === 'unavailable') {
      expect(findings).toHaveTextContent('Evaluation unavailable');
      expect(findings).not.toHaveTextContent('Evaluating');
    } else {
      expect(findings).toHaveTextContent('Evaluating');
    }
    view.unmount();
    client.clear();
  });
});
