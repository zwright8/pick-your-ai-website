import { describe, expect, it } from 'vitest';
import { assertContract } from '../../src/contracts';
import { DEMO_PRICEBOOK } from '../../src/data/fixture/pricebook';
import { estimateCost } from '../../src/domain/cost';
import { costHeadline } from '../../src/features/builder/analysis';
import { costShort } from '../../src/lib/item-cost';
import { apiChat, BY_ID, NOW } from './scenarios';

describe('complete totals without cost lines', () => {
  it('shows a nonzero tax-only total rather than hiding it', () => {
    const estimate = assertContract('CostEstimate', {
      ...estimateCost(apiChat(), BY_ID, DEMO_PRICEBOOK, { now: NOW }),
      line_items: [],
      coverage: 'complete',
      unpriced_selection_ids: [],
      subtotal: { amount: '0.00', currency: 'USD' },
      tax: { amount: '12.50', currency: 'USD' },
      total: { amount: '12.50', currency: 'USD' },
    });
    expect(costHeadline(estimate).text).toBe('$12.50 / 30 days');
    expect(costShort(estimate).text).toBe('$12.50');
  });

  it('still identifies an empty zero estimate as having no metered costs', () => {
    const estimate = assertContract('CostEstimate', {
      ...estimateCost(apiChat(), BY_ID, DEMO_PRICEBOOK, { now: NOW }),
      line_items: [],
      coverage: 'complete',
      unpriced_selection_ids: [],
      subtotal: { amount: '0', currency: 'USD' },
      tax: { amount: '0', currency: 'USD' },
      total: { amount: '0.000', currency: 'USD' },
    });
    expect(costHeadline(estimate).text).toBe('No metered costs');
    expect(costShort(estimate).text).toBe('No metered costs');
  });
});
