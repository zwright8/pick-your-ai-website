/*
 * Component comparison presentation (review 5591558191, findings 4, 5 and 6).
 *
 *  - the cost row keeps the pricing qualifiers (a partial estimate is a lower bound, `Included*`
 *    keeps its asterisk) instead of reducing the amount to a bare number;
 *  - selections the catalog's compare tray accepted across tiers are rendered, not silently dropped;
 *  - an explicitly cleared comparison stays empty (`ids=`), rather than being refilled with the
 *    tier's defaults as if it were a first visit.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { assertContract } from '../../src/contracts/validation';
import type { BuildSnapshot } from '../../src/contracts';
import { DataContext } from '../../src/app/data-context';
import { ToastProvider } from '../../src/components/feedback';
import { createFixtureProviders } from '../../src/data/fixture/providers';
import { createDraft } from '../../src/domain/build';
import ComparePage from '../../src/pages/ComparePage';
import { BY_ID, NOW, apiChat, item } from './scenarios';

vi.mock('../../src/app/builder-context', () => ({ useBuilder: vi.fn() }));

const { useBuilder } = await import('../../src/app/builder-context');

/** The URL is part of the contract here: `ids=` (cleared) must stay distinct from no `ids`. */
function UrlProbe() {
  const location = useLocation();
  return <output data-testid="url">{location.search}</output>;
}

function show(
  path: string,
  omitFirstDescription = false,
  customLicenseComparison = false,
  revisions?: [BuildSnapshot, BuildSnapshot],
  amounts?: readonly [string, string],
  inconsistentCurrency = false,
  configure?: (providers: ReturnType<typeof createFixtureProviders>) => void,
) {
  const first = revisions?.[0] ?? { ...apiChat(), revision: 1 };
  const second = revisions?.[1] ?? { ...first, revision: 2 };
  const draft = { ...createDraft(second), revisions: [first, second] };
  const providers = createFixtureProviders({ now: () => NOW });
  configure?.(providers);
  if (amounts) {
    const estimate = providers.pricing.estimate.bind(providers.pricing);
    vi.spyOn(providers.pricing, 'estimate').mockImplementation(async (build) => {
      const result = await estimate(build);
      return {
        ...result,
        coverage: 'complete',
        subtotal: { ...result.subtotal, amount: build.revision === 1 ? amounts[0] : amounts[1] },
        tax: { ...result.tax, amount: '0' },
        total: {
          ...result.total,
          amount: build.revision === 1 ? amounts[0] : amounts[1],
          currency: inconsistentCurrency && build.revision === 1 ? 'EUR' : result.total.currency,
        },
      };
    });
  }
  if (omitFirstDescription) {
    const snapshot = providers.catalog.getSnapshot.bind(providers.catalog);
    vi.spyOn(providers.catalog, 'getSnapshot').mockImplementation(async () => {
      const catalog = await snapshot();
      return {
        ...catalog,
        items: catalog.items.map((item) => {
          if (item.id !== 'demo.workload.support-chat') return item;
          const copy = { ...item };
          delete copy.description;
          return copy;
        }),
      };
    });
  }
  if (customLicenseComparison) {
    const snapshot = providers.catalog.getSnapshot.bind(providers.catalog);
    vi.spyOn(providers.catalog, 'getSnapshot').mockImplementation(async () => {
      const catalog = await snapshot();
      return assertContract('CatalogSnapshot', {
        ...catalog,
        items: catalog.items.map((item) =>
          ['demo.workload.support-chat', 'demo.workload.document-qa'].includes(item.id)
            ? {
                ...item,
                billing_class: 'free',
                license: {
                  spdx_id: item.id === 'demo.workload.support-chat' ? 'MIT' : 'LicenseRef-MIT',
                },
              }
            : item,
        ),
      });
    });
  }
  vi.spyOn(providers.builds, 'get').mockImplementation(async (id) => {
    const build = revisions?.find((revision) => revision.id === id) ?? second;
    return createDraft({ ...build, id });
  });
  vi.mocked(useBuilder).mockReturnValue({
    draft,
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
  return render(
    <QueryClientProvider client={client}>
      <DataContext.Provider value={providers}>
        <MemoryRouter initialEntries={[path]}>
          <ToastProvider>
            <ComparePage />
            <UrlProbe />
          </ToastProvider>
        </MemoryRouter>
      </DataContext.Provider>
    </QueryClientProvider>,
  );
}

const costRow = async () => {
  const table = await screen.findByRole('table');
  return within(table).getByRole('row', { name: /Est\. cost/ });
};

describe('component comparison', () => {
  it.each([
    ['foreign', 'Unknown'],
    ['ambiguous', 'Unknown'],
    ['mixed', 'Incompatible'],
  ] as const)('uses version-matched compatibility in comparison (%s)', async (state, expected) => {
    const model = item('model', 'aurora-mini');
    const current = {
      catalog_item_id: model.id,
      catalog_item_version: model.version,
      verdict: 'incompatible' as const,
      rule_ids: [],
    };
    const other = {
      ...current,
      catalog_item_version: state === 'ambiguous' ? model.version : '9.0.0',
      verdict: 'compatible' as const,
    };
    show(
      '/compare?ids=demo~model~aurora-mini',
      false,
      false,
      undefined,
      undefined,
      false,
      (providers) => {
        vi.spyOn(providers.compatibility, 'compatibleOptions').mockResolvedValue(
          state === 'foreign' ? [other] : [other, current],
        );
      },
    );
    const row = await screen.findByRole('row', { name: /Fits your stack/ });
    expect(await within(row).findByText(expected)).toBeVisible();
  });

  it('keeps valid slots usable and explains a malformed ID in the same link', async () => {
    show('/compare?ids=demo~model~aurora-large,%25');
    expect(await screen.findByRole('link', { name: 'Demo Aurora Large' })).toBeVisible();
    expect(screen.getByText(/component from this link could not be found/i)).toHaveTextContent(
      'slot 2',
    );
    expect(screen.getAllByText('Empty slot')).toHaveLength(1);
  });

  it('accepts normally URL-encoded component IDs', async () => {
    show('/compare?ids=demo%7Emodel%7Eaurora-large');
    expect(await screen.findByRole('link', { name: 'Demo Aurora Large' })).toBeVisible();
    expect(
      screen.queryByText(/component from this link could not be found/i),
    ).not.toBeInTheDocument();
  });

  it('explains outdated IDs without refilling explicitly empty slots', async () => {
    show('/compare?ids=demo~model~removed,,demo~model~aurora-mini');
    expect(await screen.findByRole('link', { name: 'Demo Aurora Mini' })).toBeVisible();
    expect(screen.getByText(/component from this link could not be found/i)).toHaveTextContent(
      'slot 1',
    );
    expect(screen.getAllByText('Empty slot')).toHaveLength(1);
  });

  it('identifies every unresolved slot in a mixed comparison link', async () => {
    show('/compare?ids=%25,demo~model~aurora-large,demo~model~missing');
    await screen.findByRole('link', { name: 'Demo Aurora Large' });
    expect(screen.getByText(/components from this link could not be found/i)).toHaveTextContent(
      'slots 1, 3',
    );
  });

  it('keeps an unresolved slot when a different slot is changed', async () => {
    show('/compare?ids=%25,demo~model~aurora-large');
    await screen.findByRole('link', { name: 'Demo Aurora Large' });
    await userEvent.selectOptions(
      screen.getByLabelText('Slot 2', { exact: true }),
      'demo.model.aurora-mini',
    );
    const params = new URLSearchParams(screen.getByTestId('url').textContent ?? '');
    expect(params.get('ids')).toBe('%,demo~model~aurora-mini');
    expect(screen.getByText(/component from this link could not be found/i)).toBeVisible();
  });

  it('allows an unresolved slot to be cleared without replacing it', async () => {
    show('/compare?ids=%25,demo~model~aurora-large');
    await screen.findByRole('link', { name: 'Demo Aurora Large' });
    const slot = screen.getByLabelText('Slot 1', { exact: true });
    expect(slot).toHaveValue('%');
    expect(within(slot).getByRole('option', { name: 'Unavailable component' })).toBeInTheDocument();
    expect(
      within(slot).getByRole('option', { name: 'Clear unavailable component' }),
    ).toBeInTheDocument();
    await userEvent.selectOptions(slot, '');
    const params = new URLSearchParams(screen.getByTestId('url').textContent ?? '');
    expect(params.get('ids')).toBe(',demo~model~aurora-large');
    expect(
      screen.queryByText(/component from this link could not be found/i),
    ).not.toBeInTheDocument();
  });

  it.each([
    'demo~workload~support-chat,demo~workload~document-qa',
    'demo~workload~document-qa,demo~workload~support-chat',
  ])('marks absent and present descriptions as different in either order: %s', async (ids) => {
    show(`/compare?ids=${ids}`, true);
    const table = await screen.findByRole('table');
    const row = within(table).getByRole('row', { name: /What it is/ });
    expect(row).toHaveTextContent('No description recorded');
    expect(row.querySelector('.diffmark')).not.toBeNull();
    for (const cell of within(row).getAllByRole('cell').slice(0, 2)) {
      expect(cell).toHaveClass('is-diff');
    }
  });

  it('distinguishes a custom license reference from the matching standard identifier', async () => {
    show('/compare?ids=demo~workload~support-chat,demo~workload~document-qa', false, true);
    const table = await screen.findByRole('table');
    const row = within(table).getByRole('row', { name: /Licence/ });
    expect(within(row).getByText('MIT', { exact: true })).toBeInTheDocument();
    expect(within(row).getByText('LicenseRef-MIT', { exact: true })).toBeInTheDocument();
    expect(row.querySelector('.diffmark')).not.toBeNull();
  });

  it('keeps the lower-bound marker and the unpriced caveat', async () => {
    // Aurora Mini's output-token rate is expired, so its support-chat price is a lower bound.
    show('/compare?ids=demo~model~aurora-mini,demo~model~aurora-large');
    const row = await costRow();
    expect(row).toHaveTextContent('≥ $14.40');
    expect(row).toHaveTextContent('partial');
    expect(row).toHaveTextContent('$324');
    // The explanation behind the marker is reachable, not lost.
    expect(
      within(row)
        .getByText(/≥\s*\$14\.40/)
        .closest('[title]')
        ?.getAttribute('title'),
    ).toMatch(/Lower bound/);
  });

  it('keeps the Included* qualifier instead of flattening it to a bare amount', async () => {
    show('/compare?ids=demo~guardrail~shield,demo~guardrail~pii-filter');
    const row = await costRow();
    expect(within(row).getAllByText('Included*')).toHaveLength(2);
    expect(row).not.toHaveTextContent(/^\$0/);
  });

  it('renders comparison selections from different tiers', async () => {
    // Both ids are accepted by the catalog's compare tray, which is not tier-scoped.
    show('/compare?ids=demo~model~aurora-mini,demo~accelerator~c24');
    expect(await screen.findByRole('link', { name: 'Demo Aurora Mini' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Demo C24 GPU' })).toBeInTheDocument();
    expect(screen.queryAllByText('Empty slot')).toHaveLength(1);
    // The out-of-layer product is labelled with its own layer in the slot picker.
    expect(
      screen.getAllByRole('option', { name: /Demo C24 GPU — .*\(T2 / }).length,
    ).toBeGreaterThan(0);
  });

  it('resolves every accelerator reference in hosting comparisons', async () => {
    show('/compare?ids=demo~hosting_platform~nimbus-cloud,demo~hosting_platform~onprem-rack');
    const table = await screen.findByRole('table');
    const row = within(table).getByRole('row', { name: /Accelerator/ });
    expect(row).toHaveTextContent('Demo C24 GPU');
    expect(row).toHaveTextContent('Demo C80 GPU');
    expect(row).toHaveTextContent('Demo R48 Accelerator');
    expect(row).not.toHaveTextContent('demo.accelerator.');
    expect(row.querySelector('.is-diff')).not.toBeNull();
  });

  it('resolves data-source reference arrays in knowledge-base comparisons', async () => {
    show('/compare?ids=demo~knowledge_base~policies,demo~knowledge_base~customers');
    const table = await screen.findByRole('table');
    const row = within(table).getByRole('row', { name: /Data source/ });
    expect(row).toHaveTextContent('Demo Policy File Share');
    expect(row).toHaveTextContent('Demo CRM Connector');
    expect(row).not.toHaveTextContent('demo.data_source.');
  });

  it('keeps an explicitly cleared comparison empty', async () => {
    // `ids=` is the explicit "cleared" form; a missing `ids` means "first visit" and seeds defaults.
    show('/compare?layer=T1&ids=');
    expect(await screen.findAllByText('Empty slot')).toHaveLength(3);
    expect(screen.queryByRole('link', { name: /Demo Aurora Large/ })).toBeNull();
    for (const select of screen.getAllByRole('combobox')) {
      expect(select).toHaveValue('');
    }
  });

  it('does not refill the slots after the last one is cleared', async () => {
    show('/compare?ids=demo~model~aurora-large');
    expect(await screen.findByRole('link', { name: 'Demo Aurora Large' })).toBeInTheDocument();

    // "Choose a component…" is the empty option: clearing the last populated slot must persist.
    const selects = screen.getAllByRole('combobox');
    await userEvent.selectOptions(selects[0]!, '');

    expect(screen.getByTestId('url')).toHaveTextContent('ids=');
    expect(screen.getAllByText('Empty slot')).toHaveLength(3);
    // The old behaviour deleted `ids`, so the defaults were seeded again after the clear.
    expect(screen.queryByRole('link', { name: 'Demo Aurora Large' })).toBeNull();
  });
});

describe('evaluation coverage and build comparison structure', () => {
  it('rejects a mismatched report and allows comparison to recover', async () => {
    let invalid = true;
    show('/compare?revisions=1,2', false, false, undefined, undefined, false, (providers) => {
      const evaluate = providers.compatibility.evaluate.bind(providers.compatibility);
      vi.spyOn(providers.compatibility, 'evaluate').mockImplementation(async (build, evidence) => {
        const report = await evaluate(build, evidence);
        return invalid && build.revision === 1 ? { ...report, ruleset_id: 'foreign' } : report;
      });
    });
    const section = await screen.findByRole('region', { name: 'Compatibility outcomes' });
    await within(section).findByText(
      'Evaluation report does not match the build or its pinned artifacts.',
    );
    expect(section).toHaveAttribute('aria-busy', 'false');
    expect(within(section).queryByRole('table')).not.toBeInTheDocument();
    invalid = false;
    await userEvent.click(within(section).getByRole('button', { name: 'Try again' }));
    await within(section).findByRole('table', { name: 'Number of checks per outcome for A and B' });
  });

  it('labels a current catalog name when both revisions pin an older component', async () => {
    const base = apiChat();
    const first = {
      ...base,
      revision: 1,
      selections: base.selections.map((selection) =>
        selection.id === 'sel_model'
          ? { ...selection, catalog_item_version: 'older-version' }
          : selection,
      ),
    };
    show('/compare?revisions=1,2', false, false, [first, { ...first, revision: 2 }]);
    await userEvent.click(
      await screen.findByRole('checkbox', { name: 'Show unchanged selections' }),
    );
    const region = screen.getByRole('region', { name: 'Selection differences' });
    const row = await within(region).findByRole('row', { name: /Demo Aurora Large.*Unchanged/ });
    expect(row).toHaveTextContent('current catalog name; selected version: older-version');
  });

  it('shows both pinned versions when comparing revisions of the same component', async () => {
    const base = apiChat();
    const first = {
      ...base,
      revision: 1,
      selections: base.selections.map((selection) =>
        selection.id === 'sel_model'
          ? { ...selection, catalog_item_version: 'older-version' }
          : selection,
      ),
    };
    const second = { ...base, revision: 2 };
    show('/compare?revisions=1,2', false, false, [first, second]);
    const region = await screen.findByRole('region', { name: 'Selection differences' });
    const row = await within(region).findByRole('row', { name: /Demo Aurora Large.*Changed/ });
    expect(row).toHaveTextContent('older-version');
    expect(row).toHaveTextContent(item('model', 'aurora-large').version);
  });

  it.each([
    ['1', '1.005', '+$0.005'],
    ['1.005', '1', '−$0.005'],
    ['9007199254740992', '9007199254740993', '+$1.00'],
    ['2.50', '2.5', 'no change'],
  ] as const)('shows an exact cost difference from %s to %s', async (first, second, expected) => {
    show('/compare?revisions=1,2', false, false, undefined, [first, second]);
    const heading = await screen.findByText('Difference (B − A):');
    expect(heading.parentElement).toHaveTextContent(expected);
  });

  it('does not subtract a total whose currency conflicts with its estimate', async () => {
    show('/compare?revisions=1,2', false, false, undefined, ['1', '2'], true);
    expect(
      await screen.findByText('Cost estimate contains inconsistent currencies.'),
    ).toBeVisible();
    expect(screen.queryByText('Difference (B − A):')).not.toBeInTheDocument();
  });

  it('reports changes to a repeated kind and role without dropping either selection', async () => {
    const base = apiChat();
    const model = base.selections.find((selection) => selection.kind === 'model');
    if (!model) throw new Error('Missing model fixture');
    const repeated = { ...model, id: 'sel_model_extra', catalog_item_id: 'demo.model.aurora-mini' };
    const added = { ...model, id: 'sel_model_new' };
    const first = { ...base, revision: 1, selections: [...base.selections, repeated] };
    const second = {
      ...first,
      revision: 2,
      selections: [
        ...first.selections.map((s) => (s.id === model.id ? { ...s, enabled: false } : s)),
        added,
      ],
    };
    show('/compare?revisions=1,2', false, false, [first, second]);
    const region = await screen.findByRole('region', { name: 'Selection differences' });
    expect(
      await within(region).findByRole('row', {
        name: /Demo Aurora Large.*disabled.*Settings changed/,
      }),
    ).toBeVisible();
    expect(within(region).getByRole('row', { name: /Demo Aurora Large.*Added/ })).toBeVisible();
    expect(screen.queryByText('The selections are identical.')).not.toBeInTheDocument();
  });

  it('reports a removed primary and promotion of the surviving secondary separately', async () => {
    const base = apiChat();
    const model = base.selections.find((selection) => selection.kind === 'model');
    if (!model) throw new Error('Missing model fixture');
    const secondary = {
      ...model,
      id: 'sel_model_extra',
      role: 'secondary',
      catalog_item_id: 'demo.model.aurora-mini',
    };
    const first = { ...base, revision: 1, selections: [...base.selections, secondary] };
    const second = {
      ...first,
      revision: 2,
      selections: first.selections
        .filter((s) => s.id !== model.id)
        .map((s) => (s.id === secondary.id ? { ...s, role: 'primary' } : s)),
    };
    show('/compare?revisions=1,2', false, false, [first, second]);
    const region = await screen.findByRole('region', { name: 'Selection differences' });
    expect(
      await within(region).findByRole('row', { name: /Demo Aurora Large.*Removed/ }),
    ).toBeVisible();
    expect(
      within(region).getByRole('row', {
        name: /Demo Aurora Mini.*secondary.*Demo Aurora Mini.*primary.*Changed/,
      }),
    ).toBeVisible();
  });

  it('compares independent builds by role even when their generated selection IDs collide', async () => {
    const base = apiChat();
    const model = base.selections.find((selection) => selection.kind === 'model');
    if (!model) throw new Error('Missing model fixture');
    const secondary = {
      ...model,
      id: 'sel_model_extra',
      role: 'secondary',
      catalog_item_id: 'demo.model.aurora-mini',
    };
    const first = { ...base, id: 'build.test.a', selections: [...base.selections, secondary] };
    const second = {
      ...first,
      id: 'build.test.b',
      selections: first.selections.map((selection) =>
        selection.id === model.id
          ? { ...selection, id: secondary.id }
          : selection.id === secondary.id
            ? { ...selection, id: model.id }
            : selection,
      ),
    };
    show('/compare?builds=build.test.a,build.test.b', false, false, [first, second]);
    expect(await screen.findByText('The selections are identical.')).toBeVisible();
  });

  it('shows offline and online evaluation coverage in the comparison', async () => {
    show('/compare?ids=demo~evaluation_suite~quality-gate');
    const table = await screen.findByRole('table');
    expect(within(table).getByRole('row', { name: /^Mode / })).toHaveTextContent('Both');
    expect(table).not.toHaveTextContent('API or local');
  });

  it.each([
    '/compare?revisions=1,2',
    '/compare?builds=build.test.a,build.test.b',
    '/compare?revisions=1',
    '/compare?builds=build.test.a',
  ])('keeps one page heading and wrapper for %s', async (path) => {
    const { container } = show(path);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Compare builds' })).toBeInTheDocument();
    expect(container.querySelector('.app-page.parts-page > .container')).not.toBeNull();
    if (path.includes(',2') || path.includes(',build.')) {
      await screen.findByRole('heading', { name: 'Estimated cost' });
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    }
  });
});
