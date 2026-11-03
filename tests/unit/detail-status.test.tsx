import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { useBuilder } from '../../src/app/builder-context';
import { DataContext } from '../../src/app/data-context';
import { ToastProvider } from '../../src/components/feedback';
import { createFixtureProviders } from '../../src/data/fixture/providers';
import { createDraft } from '../../src/domain/build';
import ComponentDetailPage from '../../src/features/catalog/ComponentDetailPage';
import { BY_ID, NOW, apiChat, item } from './scenarios';

vi.mock('../../src/app/builder-context', () => ({ useBuilder: vi.fn() }));

describe('component detail compatibility presentation', () => {
  it('does not show a cached compatible verdict after refresh fails', async () => {
    vi.mocked(useBuilder).mockReturnValue({
      draft: createDraft(apiChat()),
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
    const model = item('model', 'aurora-mini');
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
          <MemoryRouter initialEntries={['/catalog/model/demo~model~aurora-mini']}>
            <Routes>
              <Route path="/catalog/:kindSlug/:itemSlug" element={<ComponentDetailPage />} />
            </Routes>
          </MemoryRouter>
        </DataContext.Provider>
      </QueryClientProvider>,
    );
    expect(await screen.findByText('No conflicts in demo rules')).toBeVisible();
    options.mockRejectedValue(new Error('Compatibility unavailable'));
    await client.invalidateQueries({ queryKey: ['options'] });
    expect(
      await screen.findByText('Unknown in demo rules — not treated as compatible'),
    ).toBeVisible();
    view.unmount();
    client.clear();
  });

  it.each([
    'pending',
    'missing',
    'unknown',
    'compatible',
    'incompatible',
    'foreign',
    'ambiguous',
    'mixed',
  ] as const)('distinguishes %s from other outcomes', async (state) => {
    vi.mocked(useBuilder).mockReturnValue({
      draft: createDraft(apiChat()),
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
    const options = vi.spyOn(providers.compatibility, 'compatibleOptions').mockImplementation(() =>
      state === 'pending'
        ? new Promise(() => {})
        : Promise.resolve(
            state === 'missing'
              ? []
              : state === 'ambiguous' || state === 'mixed'
                ? [
                    {
                      catalog_item_id: 'demo.model.aurora-mini',
                      catalog_item_version:
                        state === 'mixed' ? '9.0.0' : item('model', 'aurora-mini').version,
                      verdict: 'compatible' as const,
                      rule_ids: [],
                    },
                    {
                      catalog_item_id: 'demo.model.aurora-mini',
                      catalog_item_version: item('model', 'aurora-mini').version,
                      verdict: 'incompatible' as const,
                      rule_ids: [],
                    },
                  ]
                : [
                    {
                      catalog_item_id: 'demo.model.aurora-mini',
                      catalog_item_version:
                        state === 'foreign' ? '9.0.0' : item('model', 'aurora-mini').version,
                      verdict: state === 'foreign' ? 'compatible' : state,
                      rule_ids: [],
                    },
                  ],
          ),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const view = render(
      <QueryClientProvider client={client}>
        <DataContext.Provider value={providers}>
          <MemoryRouter initialEntries={['/catalog/model/demo~model~aurora-mini']}>
            <ToastProvider>
              <Routes>
                <Route path="/catalog/:kindSlug/:itemSlug" element={<ComponentDetailPage />} />
              </Routes>
            </ToastProvider>
          </MemoryRouter>
        </DataContext.Provider>
      </QueryClientProvider>,
    );
    if (state !== 'pending') await waitFor(() => expect(client.isFetching()).toBe(0));
    const text =
      state === 'compatible'
        ? 'No conflicts in demo rules'
        : state === 'incompatible' || state === 'mixed'
          ? '1 demo conflict to review'
          : 'Unknown in demo rules — not treated as compatible';
    const status = await screen.findByText(text);
    await waitFor(() => expect(options).toHaveBeenCalled());
    expect(status.className).toBe(
      state === 'compatible'
        ? 'status-bar'
        : state === 'incompatible' || state === 'mixed'
          ? 'status-bar issue'
          : 'status-bar neutral',
    );
    expect(status.querySelector('use')).toHaveAttribute(
      'href',
      state === 'compatible'
        ? '#i-check-circle'
        : state === 'incompatible' || state === 'mixed'
          ? '#i-x-circle'
          : '#i-alert',
    );
    view.unmount();
    client.clear();
  });
});
