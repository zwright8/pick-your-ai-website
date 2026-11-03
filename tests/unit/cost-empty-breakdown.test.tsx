import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { useBuilder } from '../../src/app/builder-context';
import { DataContext } from '../../src/app/data-context';
import { ToastProvider } from '../../src/components/feedback';
import { createFixtureProviders } from '../../src/data/fixture/providers';
import { createDraft } from '../../src/domain/build';
import BuilderPage from '../../src/features/builder/BuilderPage';
import BuildSummaryPage from '../../src/pages/BuildSummaryPage';
import { apiChat, BY_ID, NOW } from './scenarios';

vi.mock('../../src/app/builder-context', () => ({ useBuilder: vi.fn() }));

describe.each(['builder', 'summary'] as const)('%s empty cost breakdown', (page) => {
  it.each(['complete', 'partial', 'unknown'] as const)(
    'presents a %s estimate without line items appropriately',
    async (coverage) => {
      const build = apiChat();
      const providers = createFixtureProviders({ now: () => NOW });
      const original = await providers.pricing.estimate(build);
      vi.spyOn(providers.pricing, 'estimate').mockResolvedValue({
        ...original,
        line_items: [],
        coverage,
        unpriced_selection_ids: coverage === 'complete' ? [] : ['sel_model'],
        subtotal: { amount: '1.25', currency: 'USD' },
        tax: { amount: '12.50', currency: 'USD' },
        total: { amount: '13.75', currency: 'USD' },
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
      const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
      const router = createMemoryRouter([
        {
          path: '*',
          element: (
            <ToastProvider>
              {page === 'builder' ? <BuilderPage /> : <BuildSummaryPage />}
            </ToastProvider>
          ),
        },
      ]);
      const view = render(
        <QueryClientProvider client={client}>
          <DataContext.Provider value={providers}>
            <RouterProvider router={router} />
          </DataContext.Provider>
        </QueryClientProvider>,
      );
      if (page === 'builder') await userEvent.click(await screen.findByText(/Cost breakdown \(/));
      expect(await screen.findByText('No line items were reported.')).toBeVisible();
      if (coverage !== 'unknown') {
        const totals = screen.getByLabelText('Cost totals');
        expect(within(totals).getByText('Subtotal').nextElementSibling).toHaveTextContent('$1.25');
        expect(within(totals).getByText('Tax').nextElementSibling).toHaveTextContent('$12.50');
        const label = coverage === 'partial' ? 'Total of priced items (lower bound)' : 'Total';
        expect(within(totals).getByText(label).nextElementSibling).toHaveTextContent('$13.75');
      } else {
        expect(screen.queryByLabelText('Cost totals')).toBeNull();
      }
      view.unmount();
      client.clear();
    },
  );
});
