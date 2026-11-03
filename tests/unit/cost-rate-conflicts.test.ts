import { describe, expect, it } from 'vitest';
import type { Pricebook } from '../../src/contracts';
import { assertContract } from '../../src/contracts';
import { DEMO_PRICEBOOK } from '../../src/data/fixture/pricebook';
import { estimateCost } from '../../src/domain/cost';
import { apiChat, BY_ID, NOW } from './scenarios';

const modelRates = DEMO_PRICEBOOK.rates.filter(
  (rate) => rate.catalog_item_id === 'demo.model.aurora-large',
);
const inputRate = modelRates.find((rate) => rate.meter === 'input_tokens_1m');
if (!inputRate) throw new Error('Missing input rate fixture');

function estimate(extra: Pricebook['rates'][number]) {
  const pricebook = assertContract('Pricebook', {
    ...DEMO_PRICEBOOK,
    rates: [...modelRates, extra],
  });
  return assertContract('CostEstimate', estimateCost(apiChat(), BY_ID, pricebook, { now: NOW }));
}

describe('competing price rates', () => {
  it('leaves a meter unpriced when multiple active quotes could apply', () => {
    const result = estimate({
      ...inputRate,
      id: 'rate.demo.competing-input',
      unit_price: { amount: '5.00', currency: 'USD' },
    });
    expect(result.coverage).toBe('partial');
    expect(result.line_items.map((line) => line.meter)).toEqual(['output_tokens_1m']);
    expect(result.unpriced_selection_ids).toContain('sel_model');
  });

  it('uses the current rate when another rate for the same meter has expired', () => {
    const result = estimate({
      ...inputRate,
      id: 'rate.demo.expired-input',
      valid_from: '2025-01-01T00:00:00Z',
      valid_until: '2025-12-31T23:59:59Z',
    });
    expect(result.coverage).toBe('complete');
    expect(result.total.amount).toBe('324.00');
    expect(result.unpriced_selection_ids).toEqual([]);
  });

  it('leaves a conditional quote unpriced when its conditions cannot be evaluated', () => {
    const conditional = { ...inputRate, conditions: ['Requires an annual commitment'] };
    const pricebook = assertContract('Pricebook', {
      ...DEMO_PRICEBOOK,
      rates: modelRates.map((rate) => (rate.id === inputRate.id ? conditional : rate)),
    });
    const result = estimateCost(apiChat(), BY_ID, pricebook, { now: NOW });
    expect(result.coverage).toBe('partial');
    expect(result.line_items.map((line) => line.meter)).toEqual(['output_tokens_1m']);
  });
});
