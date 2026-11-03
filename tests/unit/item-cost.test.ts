/*
 * Per-item price presentation regressions.
 *
 * Two defects were found in review of the dense parts register and are pinned here:
 *  1. a component can have several billable meters, so a row must sum all applicable lines and say
 *     when a meter stayed unpriced rather than presenting a partial charge as a monthly price;
 *  2. free/included is an admission outcome of the build policy, so an unverified free item must not
 *     render as Included when the policy does not allow unverified catalog items.
 */
import { describe, expect, it } from 'vitest';
import type { CatalogItem, Pricebook } from '../../src/contracts';
import { DEMO_PRICEBOOK } from '../../src/data/fixture/pricebook';
import { demoItemId } from '../../src/data/fixture/catalog';
import { estimateCost } from '../../src/domain/cost';
import { addOrReplace } from '../../src/domain/build';
import { compareItemPrices, itemPrice, type ItemPrice } from '../../src/lib/item-cost';
import { apiChat, buildWith, BY_ID, CATALOG, item, NOW } from './scenarios';

const PRICEBOOK: Pricebook = DEMO_PRICEBOOK;

/** apiChat projects 2000 requests/day × 600 in / 300 out tokens over the period. */
const build = apiChat();

describe('catalog price ordering', () => {
  const price = (amount: string | null, partial = false): ItemPrice => ({
    amount,
    currency: 'USD',
    label: '',
    note: '',
    partial,
    included: false,
  });

  it.each(['asc', 'desc'] as const)(
    'keeps lower bounds and unknowns after complete prices in %s order',
    (dir) => {
      expect(compareItemPrices(price('999'), price('1', true), dir)).toBeLessThan(0);
      expect(compareItemPrices(price('1', true), price(null), dir)).toBeLessThan(0);
    },
  );

  it('compares large decimal amounts without losing a unit to floating point', () => {
    const a = price('9007199254740992');
    const b = price('9007199254740993');
    expect(compareItemPrices(a, b, 'asc')).toBeLessThan(0);
    expect(compareItemPrices(a, b, 'desc')).toBeGreaterThan(0);
  });
});

describe('itemPrice pricebook lock', () => {
  it('does not price an item using a different catalog snapshot', () => {
    const locked = { ...build, locks: { ...build.locks, catalog_snapshot_id: 'catalog.foreign' } };
    const price = itemPrice(item('model', 'aurora-large'), locked, BY_ID, PRICEBOOK, CATALOG.id);
    expect(price.amount).toBeNull();
    expect(price.note).toContain('catalog snapshot');
    expect(
      itemPrice(item('model', 'aurora-large'), build, BY_ID, PRICEBOOK, undefined).amount,
    ).toBeNull();
  });

  it('prices a candidate at its own version while leaving a stale selected version unknown', () => {
    const model = item('model', 'aurora-large');
    const stale = {
      ...build,
      selections: build.selections.map((selection) =>
        selection.kind === 'model'
          ? { ...selection, catalog_item_version: 'older-version' }
          : selection,
      ),
    };
    const selected = stale.selections.find((selection) => selection.kind === 'model');
    if (!selected) throw new Error('Missing model selection');
    expect(itemPrice(model, stale, BY_ID, PRICEBOOK, CATALOG.id).amount).toBe('324.00');
    expect(itemPrice(model, stale, BY_ID, PRICEBOOK, CATALOG.id, selected).amount).toBeNull();
  });

  it('rejects default rates when the build locks another pricebook', () => {
    const locked = { ...build, locks: { ...build.locks, pricebook_id: 'pricebook.unavailable' } };
    const price = itemPrice(item('model', 'aurora-large'), locked, BY_ID, PRICEBOOK, CATALOG.id);
    expect(price.amount).toBeNull();
    expect(price.label).toBe('Unknown');
    expect(price.note).toContain('locked pricebook');
  });

  it('uses matching locked rates', () => {
    const custom = { ...PRICEBOOK, id: 'pricebook.custom' };
    const locked = { ...build, locks: { ...build.locks, pricebook_id: custom.id } };
    expect(
      itemPrice(item('model', 'aurora-large'), locked, BY_ID, custom, CATALOG.id).amount,
    ).not.toBeNull();
  });
});

describe('itemPrice aggregates every applicable meter', () => {
  it('shows a lower bound when one meter has competing active rates', () => {
    const large = item('model', 'aurora-large');
    const input = PRICEBOOK.rates.find(
      (rate) => rate.catalog_item_id === large.id && rate.meter === 'input_tokens_1m',
    );
    if (!input) throw new Error('Missing input rate fixture');
    const conflicting = {
      ...PRICEBOOK,
      rates: [...PRICEBOOK.rates, { ...input, id: 'rate.demo.competing-input' }],
    };
    const price = itemPrice(large, build, BY_ID, conflicting, CATALOG.id);
    expect(price.partial).toBe(true);
    expect(price.label).toMatch(/^≥ /);
    expect(price.amount).toBe('216.00');
    expect(price.note).toMatch(/cannot be resolved/);
  });

  it('sums both token meters of a model that has two valid rates', () => {
    const large = item('model', 'aurora-large');
    const price = itemPrice(large, build, BY_ID, PRICEBOOK, CATALOG.id);
    // Same arithmetic as the aggregate estimator, which is the whole point of the probe build.
    const probe = addOrReplace(
      { ...build, id: 'probe.manual', revision: 1, selections: [] },
      large,
      BY_ID,
    );
    const estimate = estimateCost(probe, BY_ID, PRICEBOOK, { now: NOW });
    const lineTotal = estimate.line_items
      .filter((line) => line.selection_id === probe.selections[0]!.id)
      .map((line) => line.amount.amount);
    expect(lineTotal).toHaveLength(2);
    expect(price.amount).toBe(estimate.subtotal.amount);
    expect(price.partial).toBe(false);
    expect(price.note).toMatch(/input tokens|output tokens/);
  });

  it('does not report only the first meter (the original defect)', () => {
    const large = item('model', 'aurora-large');
    const probe = addOrReplace(
      { ...build, id: 'probe.manual', revision: 1, selections: [] },
      large,
      BY_ID,
    );
    const estimate = estimateCost(probe, BY_ID, PRICEBOOK, { now: NOW });
    const lines = estimate.line_items.filter((l) => l.selection_id === probe.selections[0]!.id);
    expect(lines.length).toBeGreaterThan(1);
    const first = lines[0]!.amount.amount;
    const price = itemPrice(large, build, BY_ID, PRICEBOOK, CATALOG.id);
    expect(price.amount).not.toBe(first);
    expect(Number(price.amount)).toBeGreaterThan(Number(first));
  });

  it('marks a valid input meter plus an expired output meter as a partial lower bound', () => {
    // aurora-mini's output rate is deliberately expired in the demo pricebook.
    const mini = item('model', 'aurora-mini');
    const price = itemPrice(mini, build, BY_ID, PRICEBOOK, CATALOG.id);
    expect(price.amount).not.toBeNull();
    expect(price.partial).toBe(true);
    expect(price.label).toMatch(/^≥ /);
    expect(price.note).toMatch(/Lower bound/);
    expect(price.note).toMatch(/no applicable rate/);
  });

  it('is Unknown, never zero, when no rate applies at all', () => {
    const mini = item('model', 'aurora-mini');
    // Expire the only remaining applicable rate for this item.
    const expired: Pricebook = {
      ...PRICEBOOK,
      rates: PRICEBOOK.rates.map((rate) =>
        rate.catalog_item_id === mini.id
          ? { ...rate, valid_from: '2020-01-01T00:00:00Z', valid_until: '2020-02-01T00:00:00Z' }
          : rate,
      ),
    };
    const price = itemPrice(mini, build, BY_ID, expired, CATALOG.id);
    expect(price.amount).toBeNull();
    expect(price.label).toBe('Unknown');
    expect(price.partial).toBe(false);
  });

  it('keeps the current selection settings when pricing an already selected item', () => {
    const gpuHeavy = buildWith([
      ['workload', 'support-chat'],
      ['deployment_mode', 'self-hosted'],
      ['model_provider', 'openlab'],
      ['model', 'open-8b'],
      ['context_policy', 'standard-8k'],
      ['hosting_platform', 'nimbus-cloud'],
      ['accelerator', 'c24'],
      ['compute_profile', 'nimbus-1x-c24'],
      ['inference_engine', 'serve'],
    ]);
    const profile = item('compute_profile', 'nimbus-1x-c24');
    const selection = gpuHeavy.selections.find((s) => s.catalog_item_id === profile.id)!;
    const scaled = {
      ...gpuHeavy,
      selections: gpuHeavy.selections.map((s) =>
        s.id === selection.id ? { ...s, settings: { ...s.settings, instances: 3 } } : s,
      ),
    };
    const one = itemPrice(profile, gpuHeavy, BY_ID, PRICEBOOK, CATALOG.id);
    const three = itemPrice(profile, scaled, BY_ID, PRICEBOOK, CATALOG.id);
    expect(one.amount).not.toBeNull();
    expect(three.amount).not.toBeNull();
    // Defaults must not replace the user's configured instance count.
    expect(Number(three.amount)).toBeGreaterThan(Number(one.amount));
  });

  it('returns Unknown when there is no build or no pricebook, and for unknown billing', () => {
    const large = item('model', 'aurora-large');
    expect(itemPrice(large, null, BY_ID, PRICEBOOK, CATALOG.id).label).toBe('Unknown');
    expect(itemPrice(large, build, BY_ID, undefined, CATALOG.id).label).toBe('Unknown');
    const unknownBilling = item('data_source', 'crm') as CatalogItem;
    expect(unknownBilling.billing_class).toBe('unknown');
    expect(itemPrice(unknownBilling, build, BY_ID, PRICEBOOK, CATALOG.id).label).toBe('Unknown');
  });
});

describe('itemPrice derives free/included from the build policy', () => {
  const freeItem = item('integration', 'webhook');

  it('is unverified demo data, so admission follows the build policy, not the item', () => {
    expect(freeItem.billing_class).toBe('free');
    expect(freeItem.provenance.every((p) => p.verification_status !== 'verified')).toBe(true);
    // A build with no policy at all must not admit an unverified free item as zero cost.
    const noPolicy = { ...build, policy: undefined };
    const rejected = itemPrice(freeItem, noPolicy, BY_ID, PRICEBOOK, CATALOG.id);
    expect(rejected.amount).toBeNull();
    expect(rejected.included).toBe(false);
    expect(rejected.label).toBe('Unknown');
    expect(rejected.note).toMatch(/unverified/i);
  });

  it('is still not Included when the policy explicitly disallows unverified items', () => {
    const strict = { ...build, policy: { ...build.policy, allow_unverified_catalog_items: false } };
    const price = itemPrice(freeItem, strict, BY_ID, PRICEBOOK, CATALOG.id);
    expect(price.amount).toBeNull();
    expect(price.included).toBe(false);
  });

  it('is Included only when the policy allows unverified catalog items, and says so', () => {
    const loose = { ...build, policy: { ...build.policy, allow_unverified_catalog_items: true } };
    const price = itemPrice(freeItem, loose, BY_ID, PRICEBOOK, CATALOG.id);
    expect(price.amount).toBe('0.00');
    expect(price.included).toBe(true);
    expect(price.label).toBe('Included*');
    expect(price.note).toMatch(/unverified/i);
  });

  it('is Include without the caveat when recorded provenance is verified', () => {
    const verified: CatalogItem = {
      ...freeItem,
      provenance: freeItem.provenance.map((p) => ({ ...p, verification_status: 'verified' })),
    };
    const byId = new Map(BY_ID).set(verified.id, verified);
    const price = itemPrice(verified, build, byId, PRICEBOOK, CATALOG.id);
    expect(price.amount).toBe('0.00');
    expect(price.included).toBe(true);
    expect(price.label).toBe('Included');
  });
});

describe('itemPrice refuses to invent a price', () => {
  it('never returns a zero amount for a metered item with no rate', () => {
    for (const candidate of CATALOG.items.filter((i) => i.billing_class === 'metered')) {
      const price = itemPrice(candidate, build, BY_ID, PRICEBOOK, CATALOG.id);
      if (price.amount !== null) continue;
      expect(price.label).toBe('Unknown');
    }
    // At least one metered demo item must be unpriceable, or this test proves nothing.
    const unpriced = CATALOG.items.filter(
      (i) =>
        i.billing_class === 'metered' &&
        itemPrice(i, build, BY_ID, PRICEBOOK, CATALOG.id).amount === null,
    );
    expect(unpriced.length).toBeGreaterThan(0);
  });

  it('does not leak the probe id into any note', () => {
    for (const candidate of CATALOG.items) {
      const price = itemPrice(candidate, build, BY_ID, PRICEBOOK, CATALOG.id);
      expect(price.note).not.toContain('probe.');
      expect(price.label).not.toContain('probe.');
    }
  });

  it('prices the demo item ids that the parts register renders', () => {
    const large = demoItemId('model', 'aurora-large');
    expect(BY_ID.has(large)).toBe(true);
    expect(
      itemPrice(item('model', 'aurora-large'), build, BY_ID, PRICEBOOK, CATALOG.id).amount,
    ).toMatch(/^\d+\.\d{2}$/);
  });
});
