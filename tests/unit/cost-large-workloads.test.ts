import { describe, expect, it } from 'vitest';
import { assertContract } from '../../src/contracts';
import { DEMO_PRICEBOOK } from '../../src/data/fixture/pricebook';
import { estimateCost } from '../../src/domain/cost';
import { apiChat, BY_ID, NOW } from './scenarios';

const pricebook = {
  ...DEMO_PRICEBOOK,
  rates: DEMO_PRICEBOOK.rates.filter((rate) => rate.id === 'rate.demo.aurora-large.in'),
};

describe('workload projection precision', () => {
  it('preserves exact quantities when safe integer inputs have a large product', () => {
    const build = apiChat();
    build.objectives.requests_per_day = 1_000_000_001;
    build.objectives.avg_input_tokens = 1_000_000_001;
    assertContract('BuildSnapshot', build);

    const estimate = assertContract(
      'CostEstimate',
      estimateCost(build, BY_ID, pricebook, { now: NOW }),
    );
    expect(estimate.line_items[0]?.quantity).toBe('30000000060000.00003');
    expect(estimate.line_items[0]?.amount.amount).toBe('90000000180000.00');
  });

  it('prices the largest supported integer objectives without exponent notation', () => {
    const build = apiChat();
    build.objectives.requests_per_day = Number.MAX_SAFE_INTEGER;
    build.objectives.avg_input_tokens = Number.MAX_SAFE_INTEGER;
    assertContract('BuildSnapshot', build);

    const estimate = assertContract(
      'CostEstimate',
      estimateCost(build, BY_ID, pricebook, { now: NOW }),
    );
    expect(estimate.line_items[0]?.quantity).toBe('2433889152438199910441714869.86243');
  });

  it('keeps large request counts exact for request-based rates', () => {
    const build = apiChat();
    build.objectives.requests_per_day = Number.MAX_SAFE_INTEGER;
    const requestPricebook = {
      ...pricebook,
      rates: pricebook.rates.map((rate) => ({ ...rate, meter: 'request' as const })),
    };
    const estimate = assertContract(
      'CostEstimate',
      estimateCost(build, BY_ID, requestPricebook, { now: NOW }),
    );
    expect(estimate.line_items[0]?.quantity).toBe('270215977642229730');
    expect(estimate.line_items[0]?.amount.amount).toBe('810647932926689190.00');
  });

  it('leaves an unsafe imported integer unpriced instead of presenting a rounded value', () => {
    const build = apiChat();
    build.objectives.requests_per_day = 10_000_000_000_000_000;
    assertContract('BuildSnapshot', build);
    const estimate = estimateCost(build, BY_ID, pricebook, { now: NOW });
    expect(estimate.coverage).toBe('unknown');
    expect(estimate.line_items).toHaveLength(0);
    expect(estimate.unpriced_selection_ids).toContain('sel_model');
  });
});
