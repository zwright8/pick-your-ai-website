/*
 * Catalog selection actions (review 5591558191, findings 1 and 2).
 *
 * The parts register must not re-apply a component that is already in the stack — doing so ran
 * `replaceSelection` over the existing selection and silently reset every configured setting — and
 * a `cardinality: many` kind must be able to take a second selection through the explicit `?add=1`
 * path the builder links to.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useBuilder } from '../../src/app/builder-context';
import { DataContext } from '../../src/app/data-context';
import type { BuildSnapshot, ComponentKind } from '../../src/contracts';
import { assertContract } from '../../src/contracts';
import { createFixtureProviders } from '../../src/data/fixture/providers';
import { addOrReplace, createDraft, setEnabled, updateSettings } from '../../src/domain/build';
import { estimateCost } from '../../src/domain/cost';
import { DEMO_PRICEBOOK } from '../../src/data/fixture/pricebook';
import { PartList } from '../../src/features/catalog/PartList';
import { BY_ID, NOW, buildWith, apiChat, item, selfHosted } from './scenarios';

vi.mock('../../src/app/builder-context', () => ({ useBuilder: vi.fn() }));
afterEach(() => vi.restoreAllMocks());

function show(
  build: BuildSnapshot,
  path: string,
  kind: ComponentKind = 'tool',
  configure?: (providers: ReturnType<typeof createFixtureProviders>) => void,
) {
  const apply = vi.fn();
  vi.mocked(useBuilder).mockReturnValue({
    draft: createDraft(build),
    ready: true,
    catalogById: BY_ID,
    lastChange: null,
    saveState: { status: 'saved' },
    apply,
    startNew: vi.fn(),
    open: vi.fn(),
    restore: vi.fn(),
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const providers = createFixtureProviders({ now: () => NOW });
  configure?.(providers);
  const compatibleOptions = vi.spyOn(providers.compatibility, 'compatibleOptions');
  const view = render(
    <QueryClientProvider client={client}>
      <DataContext.Provider value={providers}>
        <MemoryRouter initialEntries={[path]}>
          <PartList mode="kind" kind={kind} />
        </MemoryRouter>
      </DataContext.Provider>
    </QueryClientProvider>,
  );
  return { ...view, apply, compatibleOptions, client };
}

const withTool = () => buildWith([...apiChatPicks(), ['tool', 'search']]);

function apiChatPicks(): [string, string][] {
  return [
    ['workload', 'support-chat'],
    ['deployment_mode', 'api'],
    ['model_provider', 'aurora'],
    ['model', 'aurora-large'],
    ['context_policy', 'standard-8k'],
  ];
}

describe('catalog selection actions', () => {
  it('shows unresolved model capacity as unknown after evaluating candidates', async () => {
    const { client } = show(selfHosted(), '/catalog/model?show=all', 'model');
    await waitFor(() =>
      expect(
        client
          .getQueryCache()
          .findAll({ queryKey: ['compat-kind'] })
          .some((query) => query.state.status === 'success'),
      ).toBe(true),
    );
    const row = await screen.findByRole('row', { name: /Demo Open 8B/ });
    const compatibility = row.querySelector('[data-label="Compatibility"]');
    expect(compatibility).toHaveTextContent('Unknown');
    expect(compatibility).not.toHaveTextContent('Compatible');
  });

  it.each(['sel_workload', 'sel_missing'])(
    'blocks a replacement link targeting the wrong or missing slot (%s)',
    async (target) => {
      const { apply } = show(apiChat(), `/catalog/model?show=all&replace=${target}`, 'model');
      const row = await screen.findByRole('row', { name: /Demo Aurora Mini/ });
      expect(within(row).getByRole('button', { name: 'Add' })).toBeDisabled();
      expect(screen.getByText(/replacement unavailable/i)).toBeVisible();
      expect(apply).not.toHaveBeenCalled();
    },
  );

  it('blocks an ambiguous replacement slot', async () => {
    const build = apiChat();
    const model = build.selections.find((selection) => selection.id === 'sel_model');
    if (!model) throw new Error('Missing model');
    build.selections = [...build.selections, { ...model, role: 'secondary' }];
    const { apply } = show(build, '/catalog/model?show=all&replace=sel_model', 'model');
    const row = await screen.findByRole('row', { name: /Demo Aurora Mini/ });
    expect(within(row).getByRole('button', { name: 'Add' })).toBeDisabled();
    expect(screen.getByText(/replacement unavailable/i)).toBeVisible();
    expect(apply).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'allows choosing the current version when the selected version is older (replacement: %s)',
    async (replacement) => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
      const current = item('model', 'aurora-large');
      const build = apiChat();
      build.selections = build.selections.map((selection) =>
        selection.id === 'sel_model'
          ? { ...selection, catalog_item_version: 'older-version' }
          : selection,
      );
      const { apply } = show(
        build,
        `/catalog/model?show=all${replacement ? '&replace=sel_model' : ''}`,
        'model',
      );
      const row = await screen.findByRole('row', { name: /Demo Aurora Large/ });
      await waitFor(() => expect(row).toHaveTextContent('$324'));
      const button = within(row).getByRole('button', { name: 'Add' });
      expect(button).toBeEnabled();
      await userEvent.click(button);
      expect(confirm).toHaveBeenCalledWith(
        expect.stringContaining("reset this component's settings"),
      );
      const change = apply.mock.calls[0]?.[0];
      expect(change).toBeTypeOf('function');
      expect(
        change(build).selections.find((selection: { id: string }) => selection.id === 'sel_model')
          ?.catalog_item_version,
      ).toBe(current.version);
    },
  );

  it('does not ask to reset settings when adding a separate version as an additional selection', async () => {
    const confirm = vi.spyOn(window, 'confirm');
    const build = apiChat();
    build.selections = build.selections.map((selection) =>
      selection.id === 'sel_model'
        ? { ...selection, catalog_item_version: 'older-version' }
        : selection,
    );
    const { apply } = show(build, '/catalog/model?show=all&add=1', 'model');
    const row = await screen.findByRole('row', { name: /Demo Aurora Large/ });
    await userEvent.click(within(row).getByRole('button', { name: 'Add' }));
    expect(confirm).not.toHaveBeenCalled();
    const [change] = apply.mock.calls[0] as [(build: BuildSnapshot) => BuildSnapshot];
    expect(change(build).selections.filter((selection) => selection.kind === 'model')).toHaveLength(
      2,
    );
  });

  it.each([false, true])(
    'keeps the older selection when the settings reset is cancelled (replacement: %s)',
    async (replacement) => {
      vi.spyOn(window, 'confirm').mockReturnValue(false);
      const build = apiChat();
      build.selections = build.selections.map((selection) =>
        selection.id === 'sel_model'
          ? { ...selection, catalog_item_version: 'older-version' }
          : selection,
      );
      const { apply } = show(
        build,
        `/catalog/model?show=all${replacement ? '&replace=sel_model' : ''}`,
        'model',
      );
      const row = await screen.findByRole('row', { name: /Demo Aurora Large/ });
      await userEvent.click(within(row).getByRole('button', { name: 'Add' }));
      expect(apply).not.toHaveBeenCalled();
      expect(
        build.selections.find((selection) => selection.id === 'sel_model')?.catalog_item_version,
      ).toBe('older-version');
    },
  );

  it('changes a cached compatible verdict to unknown when the returned version changes', async () => {
    const model = item('model', 'aurora-mini');
    let version = model.version;
    const { client, unmount } = show(apiChat(), '/catalog/model?show=all', 'model', (providers) => {
      vi.spyOn(providers.compatibility, 'compatibleOptions').mockImplementation(async () => [
        {
          catalog_item_id: model.id,
          catalog_item_version: version,
          verdict: 'compatible',
          rule_ids: [],
        },
      ]);
    });
    const row = await screen.findByRole('row', { name: /Demo Aurora Mini/ });
    expect(await within(row).findByText('Compatible', { exact: true })).toBeVisible();
    version = '9.0.0';
    await client.invalidateQueries({ queryKey: ['compat-kind'] });
    expect(await within(row).findByText('Unknown', { exact: true })).toBeVisible();
    unmount();
    client.clear();
  });

  it.each(['asc', 'desc'])(
    'puts missing specification values after known values in %s order',
    async (dir) => {
      show(
        apiChat(),
        `/catalog/model_provider?show=all&sort=spec%3Asupported_auth&dir=${dir}`,
        'model_provider',
      );
      const region = await screen.findByRole('region', { name: 'Scrollable part list' });
      const missing = await within(region).findByRole('row', { name: /Demo Open Weights Lab/ });
      const known = await within(region).findByRole('row', { name: /Demo Provider Aurora/ });
      const rows = within(region).getAllByRole('row');
      expect(rows.indexOf(known)).toBeLessThan(rows.indexOf(missing));
    },
  );

  it.each(['asc', 'desc'])('keeps missing numeric specifications last in %s order', async (dir) => {
    show(
      apiChat(),
      `/catalog/integration?show=all&sort=spec%3Arate_limit_per_minute&dir=${dir}`,
      'integration',
    );
    const region = await screen.findByRole('region', { name: 'Scrollable part list' });
    const missing = await within(region).findByRole('row', { name: /Demo Webhook Notifier/ });
    const known = await within(region).findByRole('row', { name: /Demo Helpdesk API/ });
    const rows = within(region).getAllByRole('row');
    expect(rows.indexOf(known)).toBeLessThan(rows.indexOf(missing));
  });

  it.each([
    ['asc', 'Demo Open Weights Lab', 'Demo Provider Aurora'],
    ['desc', 'Demo Provider Aurora', 'Demo Open Weights Lab'],
  ])('sorts displayed array values lexically in %s order', async (dir, first, second) => {
    show(
      apiChat(),
      `/catalog/model_provider?show=all&sort=spec%3Asupported_auth&dir=${dir}`,
      'model_provider',
      (providers) => {
        const getSnapshot = providers.catalog.getSnapshot.bind(providers.catalog);
        vi.spyOn(providers.catalog, 'getSnapshot').mockImplementation(async (...args) => {
          const snapshot = await getSnapshot(...args);
          return assertContract('CatalogSnapshot', {
            ...snapshot,
            items: snapshot.items.map((entry) =>
              entry.kind !== 'model_provider'
                ? entry
                : {
                    ...entry,
                    spec: {
                      ...entry.spec,
                      supported_auth:
                        entry.id === item('model_provider', 'aurora').id
                          ? ['service_account']
                          : ['api_key', 'oauth2'],
                    },
                  },
            ),
          });
        });
      },
    );
    const region = await screen.findByRole('region', { name: 'Scrollable part list' });
    const firstRow = await within(region).findByRole('row', { name: new RegExp(first) });
    const secondRow = await within(region).findByRole('row', { name: new RegExp(second) });
    const rows = within(region).getAllByRole('row');
    expect(rows.indexOf(firstRow)).toBeLessThan(rows.indexOf(secondRow));
  });

  it.each(['asc', 'desc'])(
    'groups complete, partial, and unknown prices when sorting %s',
    async (dir) => {
      show(apiChat(), `/catalog/model?show=all&sort=cost&dir=${dir}`, 'model', (providers) => {
        const getSnapshot = providers.catalog.getSnapshot.bind(providers.catalog);
        vi.spyOn(providers.catalog, 'getSnapshot').mockImplementation(async (...args) => {
          const snapshot = await getSnapshot(...args);
          return {
            ...snapshot,
            items: snapshot.items.map((entry) =>
              entry.id === item('model', 'open-8b').id
                ? { ...entry, billing_class: 'unknown' as const }
                : entry,
            ),
          };
        });
      });
      const region = await screen.findByRole('region', { name: 'Scrollable part list' });
      await waitFor(() =>
        expect(within(region).getByRole('row', { name: /Demo Aurora Large/ })).toHaveTextContent(
          '$324',
        ),
      );
      const rows = within(region)
        .getAllByRole('row')
        .filter((row) => row.querySelector('[data-label="Est. cost"]'));
      const categories = rows.map((row) => {
        const cell = row.querySelector('[data-label="Est. cost"]');
        const text = cell?.textContent ?? '';
        return text.includes('Unknown') ? 'unknown' : text.includes('≥') ? 'partial' : 'complete';
      });
      expect(categories).toContain('complete');
      expect(categories).toContain('partial');
      expect(categories).toContain('unknown');
      expect(categories).toEqual(
        [...categories].sort(
          (a, b) =>
            ['complete', 'partial', 'unknown'].indexOf(a) -
            ['complete', 'partial', 'unknown'].indexOf(b),
        ),
      );
      expect(within(region).getByRole('columnheader', { name: /Est\. cost/ })).toHaveAttribute(
        'aria-sort',
        'other',
      );
      expect(
        within(region).getByRole('button', {
          name: new RegExp(`${dir === 'asc' ? 'ascending' : 'descending'} within price groups`),
        }),
      ).toBeInTheDocument();
      expect(screen.getByText(/Complete estimates come first/)).toBeVisible();
    },
  );

  it('preserves a disabled model and its configured settings when revisited', async () => {
    const build = setEnabled(
      updateSettings(apiChat(), 'sel_model', { temperature: 0.37 }),
      'sel_model',
      false,
    );
    const { apply } = show(build, '/catalog/model?show=all', 'model');
    const row = await screen.findByRole('row', { name: /Demo Aurora Large/ });
    const button = within(row).getByRole('button', { name: /In stack/ });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(apply).not.toHaveBeenCalled();
    expect(build.selections.find((s) => s.id === 'sel_model')).toMatchObject({
      enabled: false,
      settings: { temperature: 0.37 },
    });
  });

  it('does not re-apply a component that is already in the stack', async () => {
    // A configured tool: re-adding it would have reset these settings to their defaults.
    const build = updateSettings(withTool(), 'sel_tool', {
      enabled: true,
      permissions: 'read-only',
    });
    const { apply } = show(build, '/catalog/tool?show=all');

    const button = await screen.findByRole('button', { name: /In stack/ });
    expect(button).toBeDisabled();
    expect(button.getAttribute('title')).toContain('already selected');
    fireEvent.click(button);
    expect(apply).not.toHaveBeenCalled();
  });

  it('adds an additional selection of a many-kind on ?add=1 without replacing the primary', async () => {
    const build = updateSettings(withTool(), 'sel_tool', { permissions: 'read-only' });
    const { apply } = show(build, '/catalog/tool?show=all&add=1');

    expect(await screen.findByText(/Adding an additional component/i)).toBeInTheDocument();
    const row = await screen.findByRole('row', { name: /Demo Ticket Writer/ });
    await userEvent.click(within(row).getByRole('button', { name: 'Add' }));

    expect(apply).toHaveBeenCalledTimes(1);
    const [change, summary] = apply.mock.calls[0] as [(b: BuildSnapshot) => BuildSnapshot, string];
    expect(summary).toMatch(/additional/i);
    const next = change(build);
    const tools = next.selections.filter((s) => s.kind === 'tool');
    expect(tools).toHaveLength(2);
    // The existing selection and its settings survive; the new one takes a distinct role.
    expect(tools[0]!.catalog_item_id).toBe('demo.tool.search');
    expect(tools[0]!.role).toBe('primary');
    expect(tools[0]!.settings).toEqual({ enabled: true, permissions: 'read-only' });
    expect(tools[1]!.catalog_item_id).toBe('demo.tool.ticket-writer');
    expect(tools[1]!.role).toBe('secondary');
  });

  it('allows another copy of the selected item with independent settings', async () => {
    const build = updateSettings(withTool(), 'sel_tool', { permissions: 'read-only' });
    const { apply } = show(build, '/catalog/tool?show=all&add=1');
    const row = await screen.findByRole('row', { name: /Demo Web Search/ });
    // The button must name the operation: an enabled "In stack" label contradicts itself.
    const button = within(row).getByRole('button', { name: 'Add' });
    expect(button).toBeEnabled();
    await userEvent.click(button);
    const [change] = apply.mock.calls[0] as [(b: BuildSnapshot) => BuildSnapshot];
    const selections = change(build).selections.filter((s) => s.kind === 'tool');
    expect(selections).toHaveLength(2);
    expect(selections[0]).toEqual(build.selections.find((s) => s.kind === 'tool'));
    expect(selections[1]!.catalog_item_id).toBe(selections[0]!.catalog_item_id);
    expect(selections[1]!.role).toBe('secondary');
  });

  it('evaluates the role of a secondary replacement through the picker', async () => {
    const build = addOrReplace(apiChat(), item('model_provider', 'openlab'), BY_ID, {
      additional: true,
    });
    const secondary = build.selections.find(
      (s) => s.kind === 'model_provider' && s.role === 'secondary',
    )!;
    const { compatibleOptions } = show(
      build,
      `/catalog/model-provider?replace=${secondary.id}`,
      'model_provider',
    );
    await screen.findByRole('row', { name: /Demo Open Weights Lab/ });
    expect(compatibleOptions).toHaveBeenCalledWith(build, 'model_provider', 'secondary');
  });

  it('keeps the no-op guard for single-cardinality kinds even with add=1', async () => {
    show(apiChat(), '/catalog/workload?show=all&add=1', 'workload');
    const row = await screen.findByRole('row', { name: /Demo Customer Support Chat/ });
    expect(within(row).getByRole('button', { name: /In stack/ })).toBeDisabled();
  });

  it('keeps replacing the primary selection when ?add=1 is absent', async () => {
    const build = withTool();
    const { apply } = show(build, '/catalog/tool?show=all');

    const row = await screen.findByRole('row', { name: /Demo Ticket Writer/ });
    await userEvent.click(within(row).getByRole('button', { name: 'Add' }));

    expect(apply).toHaveBeenCalledTimes(1);
    const [change] = apply.mock.calls[0] as [(b: BuildSnapshot) => BuildSnapshot];
    const next = change(build);
    const tools = next.selections.filter((s) => s.kind === 'tool');
    expect(tools).toHaveLength(1);
    expect(tools[0]!.catalog_item_id).toBe('demo.tool.ticket-writer');
  });
});

it('retains the catalog heading and retries a failed catalog request in place', async () => {
  let failed = true;
  show(apiChat(), '/catalog/model', 'model', (providers) => {
    const original = providers.catalog.getSnapshot.bind(providers.catalog);
    vi.spyOn(providers.catalog, 'getSnapshot').mockImplementation((id) =>
      failed ? Promise.reject(new Error('Catalog unavailable')) : original(id),
    );
  });
  const catalogAlert = await screen.findByRole('alert');
  expect(catalogAlert).toHaveTextContent('Catalog unavailable');
  expect(screen.getByRole('heading', { level: 1, name: 'Choose an AI model' })).toBeInTheDocument();
  failed = false;
  await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByRole('table')).toBeInTheDocument();
  await waitFor(() => expect(catalogAlert).not.toBeInTheDocument());
  // Compatibility failed independently while the catalog was unavailable. Retry that too.
  await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await waitFor(() => expect(screen.queryByText('Catalog unavailable')).not.toBeInTheDocument());
});

it('prices an additional compute selection using the settings Add actually creates', async () => {
  const profile = item('compute_profile', 'nimbus-1x-c24');
  const original = selfHosted();
  const selection = original.selections.find((s) => s.catalog_item_id === profile.id)!;
  const build = updateSettings(original, selection.id, { ...selection.settings, instances: 3 });
  const { apply } = show(build, '/catalog/compute-profile?add=1&show=all', 'compute_profile');
  const row = await screen.findByRole('row', { name: new RegExp(profile.name) });
  expect(within(row).getByText('$792', { exact: true })).toBeInTheDocument();
  expect(row).not.toHaveTextContent('$2,376');
  await userEvent.click(within(row).getByRole('button', { name: 'Add' }));
  const [change] = apply.mock.calls[0] as [(b: BuildSnapshot) => BuildSnapshot];
  const added = change(build).selections.at(-1)!;
  const estimate = estimateCost({ ...build, selections: [added] }, BY_ID, DEMO_PRICEBOOK, {
    now: NOW,
  });
  expect(estimate.total.amount).toBe('792.00');
  expect(added.settings).toMatchObject({ instances: 1 });
});

it('prices replacement defaults instead of another slot using the same item', async () => {
  const profile = item('compute_profile', 'nimbus-1x-c24');
  const original = selfHosted();
  const selection = original.selections.find((s) => s.catalog_item_id === profile.id)!;
  let build = updateSettings(original, selection.id, { ...selection.settings, instances: 3 });
  build = addOrReplace(build, item('compute_profile', 'nimbus-4x-c80'), BY_ID, {
    additional: true,
  });
  const target = build.selections.at(-1)!;
  const { apply } = show(
    build,
    `/catalog/compute-profile?replace=${target.id}&show=all`,
    'compute_profile',
  );
  const row = await screen.findByRole('row', { name: new RegExp(profile.name) });
  expect(within(row).getByText('$792', { exact: true })).toBeInTheDocument();
  await userEvent.click(within(row).getByRole('button', { name: 'Add' }));
  const [change] = apply.mock.calls[0] as [(b: BuildSnapshot) => BuildSnapshot];
  const replaced = change(build).selections.find((s) => s.id === target.id)!;
  expect(replaced.settings).toMatchObject({ instances: 1 });
  expect(change(build).selections.find((s) => s.id === selection.id)?.settings).toMatchObject({
    instances: 3,
  });
});
