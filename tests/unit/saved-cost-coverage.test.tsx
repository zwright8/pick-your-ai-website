/*
 * Saved-build and starter-build totals (review 5591558191, findings 7 and 9).
 *
 * Both screens previously formatted `total.amount` alone, which lost the estimator's coverage and
 * period: a build whose components are all unpriced showed `$0`, and a partial total showed a
 * complete monthly figure. They now use the same coverage-aware presentation as the builder.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DataContext } from '../../src/app/data-context';
import { ToastProvider } from '../../src/components/feedback';
import type { BuildSnapshot } from '../../src/contracts';
import { createFixtureProviders } from '../../src/data/fixture/providers';
import { createDraft } from '../../src/domain/build';
import MyBuildsPage from '../../src/pages/MyBuildsPage';
import TemplatesPage from '../../src/pages/TemplatesPage';
import { NOW, apiChat, buildWith } from './scenarios';

vi.mock('../../src/app/builder-context', () => ({ useBuilder: vi.fn() }));

beforeEach(() => localStorage.clear());

const { useBuilder } = await import('../../src/app/builder-context');

function mockBuilder(draft: BuildSnapshot | null) {
  vi.mocked(useBuilder).mockReturnValue({
    draft: draft ? createDraft(draft) : null,
    ready: true,
    catalogById: new Map(),
    lastChange: null,
    saveState: { status: 'saved' },
    apply: vi.fn(),
    startNew: vi.fn(),
    open: vi.fn(),
    restore: vi.fn(),
  });
}

/** A stack whose every priced meter is missing: the estimator reports `coverage: unknown`. */
const unpricedStack = () =>
  buildWith([
    ['workload', 'support-chat'],
    ['deployment_mode', 'self-hosted'],
    ['model_provider', 'openlab'],
    ['model', 'open-8b'],
    ['context_policy', 'standard-8k'],
    ['hosting_platform', 'onprem-rack'],
    ['compute_profile', 'rack-2x-r48'],
    ['data_source', 'crm'],
  ]);

describe('saved build cost coverage', () => {
  it('withholds validation from a report pinned to another ruleset', async () => {
    mockBuilder(null);
    const providers = createFixtureProviders({ now: () => NOW });
    const build = apiChat();
    await providers.builds.save(createDraft(build), null);
    const evaluate = providers.compatibility.evaluate.bind(providers.compatibility);
    const evaluator = vi
      .spyOn(providers.compatibility, 'evaluate')
      .mockImplementation(async (b, evidence) => ({
        ...(await evaluate(b, evidence)),
        ruleset_id: 'ruleset.foreign',
      }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const view = render(
      <QueryClientProvider client={client}>
        <DataContext.Provider value={providers}>
          <MemoryRouter>
            <ToastProvider>
              <MyBuildsPage />
            </ToastProvider>
          </MemoryRouter>
        </DataContext.Provider>
      </QueryClientProvider>,
    );
    const card = await screen.findByRole('article');
    await waitFor(() => expect(evaluator).toHaveBeenCalled());
    await waitFor(() =>
      expect(
        client
          .getQueryCache()
          .findAll({ queryKey: ['builds', 'detail-report'] })
          .some((query) => query.state.status === 'error'),
      ).toBe(true),
    );
    expect(card).toHaveTextContent('Not checked');
    expect(card).not.toHaveTextContent('Validated');
    view.unmount();
    client.clear();
  });

  it.each(['wrong pricebook', 'mixed currency'] as const)(
    'does not show a saved estimate with %s',
    async (problem) => {
      mockBuilder(null);
      const providers = createFixtureProviders({ now: () => NOW });
      const build = apiChat();
      await providers.builds.save(createDraft(build), null);
      const invalid = structuredClone(await providers.pricing.estimate(build));
      if (problem === 'wrong pricebook') invalid.pricebook_id = 'pricebook.foreign';
      else invalid.total.currency = 'EUR';
      vi.spyOn(providers.pricing, 'estimate').mockResolvedValue(invalid);
      const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
      const view = render(
        <QueryClientProvider client={client}>
          <DataContext.Provider value={providers}>
            <MemoryRouter>
              <ToastProvider>
                <MyBuildsPage />
              </ToastProvider>
            </MemoryRouter>
          </DataContext.Provider>
        </QueryClientProvider>,
      );
      const card = await screen.findByRole('article');
      await waitFor(() => expect(card).toHaveTextContent('Unavailable'));
      expect(card).not.toHaveTextContent('$324.00');
      view.unmount();
      client.clear();
    },
  );

  it('does not present an unpriced build as $0/mo', async () => {
    mockBuilder(null);
    const providers = createFixtureProviders({ now: () => NOW });
    const build = unpricedStack();
    await providers.builds.save(createDraft(build), null);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    render(
      <QueryClientProvider client={client}>
        <DataContext.Provider value={providers}>
          <MemoryRouter>
            <ToastProvider>
              <MyBuildsPage />
            </ToastProvider>
          </MemoryRouter>
        </DataContext.Provider>
      </QueryClientProvider>,
    );

    const heading = await screen.findByRole('heading', { name: /Untitled AI stack/ });
    const card = heading.closest('article')!;
    const metric = within(card).getByText('ESTIMATED BASELINE*').parentElement!;
    await waitFor(() => expect(metric).toHaveTextContent('Unknown'));
    expect(metric).not.toHaveTextContent(/\$0/);
  });

  it('marks a partial saved total as a lower bound', async () => {
    mockBuilder(null);
    const providers = createFixtureProviders({ now: () => NOW });
    const build = buildWith([
      ['workload', 'support-chat'],
      ['deployment_mode', 'api'],
      ['model_provider', 'aurora'],
      ['model', 'aurora-mini'],
      ['context_policy', 'standard-8k'],
    ]);
    await providers.builds.save(createDraft(build), null);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    render(
      <QueryClientProvider client={client}>
        <DataContext.Provider value={providers}>
          <MemoryRouter>
            <ToastProvider>
              <MyBuildsPage />
            </ToastProvider>
          </MemoryRouter>
        </DataContext.Provider>
      </QueryClientProvider>,
    );

    const heading = await screen.findByRole('heading', { name: /Untitled AI stack/ });
    const card = heading.closest('article')!;
    const metric = within(card).getByText('ESTIMATED BASELINE*').parentElement!;
    await waitFor(() => expect(metric).toHaveTextContent('≥ $14.40'));
    expect(metric).toHaveTextContent('lower bound');
  });

  it('groups currencies and periods and orders comparable amounts without rounding', async () => {
    mockBuilder(null);
    const providers = createFixtureProviders({ now: () => NOW });
    const template = apiChat();
    const examples = [
      {
        id: 'build.us-big',
        name: 'US bigger',
        currency: 'USD',
        days: 30,
        amount: '9007199254740993',
      },
      { id: 'build.euro', name: 'Euro', currency: 'EUR', days: 30, amount: '999' },
      {
        id: 'build.us-small',
        name: 'US smaller',
        currency: 'USD',
        days: 30,
        amount: '9007199254740992',
      },
      { id: 'build.week', name: 'US week', currency: 'USD', days: 7, amount: '99999999999999999' },
      { id: 'build.partial', name: 'Partial', currency: 'EUR', days: 60, amount: '1' },
      { id: 'build.unknown', name: 'Unknown', currency: 'EUR', days: 30, amount: '0' },
    ];
    for (const example of examples)
      await providers.builds.save(
        createDraft({ ...template, id: example.id, name: example.name }),
        null,
      );
    const estimate = await providers.pricing.estimate(template);
    vi.spyOn(providers.pricing, 'estimate').mockImplementation(async (build) => {
      const example = examples.find((entry) => entry.id === build.id);
      if (!example) throw new Error(`Unexpected build ${build.id}`);
      return {
        ...estimate,
        build_id: build.id,
        currency: example.currency,
        period_days: example.days,
        subtotal: { ...estimate.subtotal, currency: example.currency },
        tax: { ...estimate.tax, currency: example.currency },
        line_items: estimate.line_items.map((line) => ({
          ...line,
          unit_price: { ...line.unit_price, currency: example.currency },
          amount: { ...line.amount, currency: example.currency },
        })),
        total: { amount: example.amount, currency: example.currency },
        coverage:
          build.id === 'build.partial'
            ? 'partial'
            : build.id === 'build.unknown'
              ? 'unknown'
              : 'complete',
      };
    });
    const report = await providers.compatibility.evaluate(template, { costEstimate: estimate });
    vi.spyOn(providers.compatibility, 'evaluate').mockResolvedValue(report);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const view = render(
      <QueryClientProvider client={client}>
        <DataContext.Provider value={providers}>
          <MemoryRouter>
            <MyBuildsPage />
          </MemoryRouter>
        </DataContext.Provider>
      </QueryClientProvider>,
    );
    await screen.findAllByRole('article');
    await waitFor(() => expect(client.isFetching()).toBe(0));
    fireEvent.change(screen.getByLabelText('SORT BY'), { target: { value: 'cost' } });
    expect(screen.getByText(/grouped by coverage, currency and period/)).toBeVisible();
    expect(
      screen.getAllByRole('article').map((card) => within(card).getByRole('heading').textContent),
    ).toEqual(['Euro', 'US week', 'US smaller', 'US bigger', 'Partial', 'Unknown']);
    const partial = screen.getByRole('heading', { name: 'Partial' }).closest('article');
    expect(partial).toHaveTextContent('Partial · EUR · 60 days');
    view.unmount();
    client.clear();
  });
});

describe('starter build cost coverage', () => {
  it('shows unavailable instead of a foreign estimate on starter cards', async () => {
    mockBuilder(apiChat());
    const providers = createFixtureProviders({ now: () => NOW });
    const foreign = { ...(await providers.pricing.estimate(apiChat())), build_id: 'build.foreign' };
    vi.spyOn(providers.pricing, 'estimate').mockResolvedValue(foreign);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const view = render(
      <QueryClientProvider client={client}>
        <DataContext.Provider value={providers}>
          <MemoryRouter>
            <ToastProvider>
              <TemplatesPage />
            </ToastProvider>
          </MemoryRouter>
        </DataContext.Provider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getAllByText('Unavailable')).toHaveLength(4));
    expect(screen.queryByText('$324.00')).toBeNull();
    view.unmount();
    client.clear();
  });

  it('labels an incomplete starter estimate as a lower bound', async () => {
    mockBuilder(apiChat());
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    render(
      <QueryClientProvider client={client}>
        <DataContext.Provider value={createFixtureProviders({ now: () => NOW })}>
          <MemoryRouter>
            <ToastProvider>
              <TemplatesPage />
            </ToastProvider>
          </MemoryRouter>
        </DataContext.Provider>
      </QueryClientProvider>,
    );

    // The Document Q&A starter leaves its vector database unpriced, so its total is a lower bound.
    const heading = await screen.findByRole('heading', { name: /Document Q&A/ });
    const card = heading.closest('article')!;
    await waitFor(() => expect(card).toHaveTextContent('≥ $188.25'));
    expect(card).toHaveTextContent('lower bound');
    expect(card).not.toHaveTextContent(/\$188\.25\s*per 30 days/);
  });
});
