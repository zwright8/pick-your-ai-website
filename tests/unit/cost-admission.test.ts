import { describe, expect, it, vi } from 'vitest';
import { estimateBuildCost } from '../../src/data/cost-evidence';
import { createFixtureProviders } from '../../src/data/fixture/providers';
import { apiChat, NOW } from './scenarios';

describe('cost estimate admission', () => {
  it.each([false, true])(
    'binds validation to the request context when the caller changes (foreign: %s)',
    async (foreign) => {
      const build = apiChat();
      const providers = createFixtureProviders({ now: () => NOW });
      const original = await providers.pricing.estimate(build);
      let resolveEstimate: ((value: typeof original) => void) | undefined;
      vi.spyOn(providers.pricing, 'estimate').mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveEstimate = resolve;
          }),
      );
      const pending = estimateBuildCost(providers.pricing, build);
      build.id = 'build.changed';
      build.revision += 1;
      build.locks.pricebook_id = 'pricebook.changed';
      if (!resolveEstimate) throw new Error('Estimate was not requested');
      resolveEstimate(
        foreign
          ? {
              ...original,
              build_id: build.id,
              build_revision: build.revision,
              pricebook_id: 'pricebook.changed',
            }
          : original,
      );
      if (foreign)
        await expect(pending).rejects.toMatchObject({
          kind: 'malformed',
          contract: 'CostEstimate',
        });
      else await expect(pending).resolves.toEqual(original);
    },
  );

  it('accepts a consistent foreign-currency estimate without conversion', async () => {
    const build = apiChat();
    const providers = createFixtureProviders({ now: () => NOW });
    const cost = structuredClone(await providers.pricing.estimate(build));
    cost.currency = 'EUR';
    cost.subtotal.currency = 'EUR';
    cost.tax.currency = 'EUR';
    cost.total.currency = 'EUR';
    for (const line of cost.line_items) {
      line.amount.currency = 'EUR';
      line.unit_price.currency = 'EUR';
    }
    vi.spyOn(providers.pricing, 'estimate').mockResolvedValue(cost);
    await expect(estimateBuildCost(providers.pricing, build)).resolves.toEqual(cost);
  });
});
