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

  it.each([false, true])(
    'checks selection IDs against the request-time snapshot (foreign: %s)',
    async (foreign) => {
      const build = apiChat();
      const providers = createFixtureProviders({ now: () => NOW });
      const original = await providers.pricing.estimate(build);
      const line = original.line_items[0];
      if (!line) throw new Error('Missing priced fixture line');
      let resolveEstimate: ((value: typeof original) => void) | undefined;
      vi.spyOn(providers.pricing, 'estimate').mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveEstimate = resolve;
          }),
      );
      const pending = estimateBuildCost(providers.pricing, build);
      build.selections = build.selections.map((selection) =>
        selection.id === line.selection_id ? { ...selection, id: 'sel_changed' } : selection,
      );
      if (!resolveEstimate) throw new Error('Estimate was not requested');
      resolveEstimate(
        foreign
          ? {
              ...original,
              line_items: original.line_items.map((item) => ({
                ...item,
                selection_id: 'sel_changed',
              })),
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

  it('requests the 30-day period explicitly and rejects a different response period', async () => {
    const build = apiChat();
    const providers = createFixtureProviders({ now: () => NOW });
    const cost = await providers.pricing.estimate(build);
    const estimate = vi
      .spyOn(providers.pricing, 'estimate')
      .mockResolvedValue({ ...cost, period_days: 7 });
    await expect(estimateBuildCost(providers.pricing, build)).rejects.toMatchObject({
      kind: 'malformed',
      contract: 'CostEstimate',
    });
    expect(estimate).toHaveBeenCalledWith(build, 30);
    estimate.mockResolvedValue(cost);
    await expect(estimateBuildCost(providers.pricing, build)).resolves.toEqual(cost);
  });

  it.each([
    ['9007199254740993.000000000001', '0.000000000002', '9007199254740993.000000000003', true],
    ['9007199254740993.000000000001', '0.000000000002', '9007199254740993.000000000002', false],
    ['0.10', '0.20', '0.3', true],
  ] as const)(
    'checks subtotal %s plus tax %s against total %s',
    async (subtotal, tax, total, consistent) => {
      const build = apiChat();
      const providers = createFixtureProviders({ now: () => NOW });
      const cost = await providers.pricing.estimate(build);
      cost.subtotal.amount = subtotal;
      cost.tax.amount = tax;
      cost.total.amount = total;
      vi.spyOn(providers.pricing, 'estimate').mockResolvedValue(cost);
      if (consistent)
        await expect(estimateBuildCost(providers.pricing, build)).resolves.toEqual(cost);
      else
        await expect(estimateBuildCost(providers.pricing, build)).rejects.toMatchObject({
          kind: 'malformed',
          contract: 'CostEstimate',
        });
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
