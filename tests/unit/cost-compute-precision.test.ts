import { describe, expect, it } from 'vitest';
import { assertContract } from '../../src/contracts';
import { DEMO_PRICEBOOK } from '../../src/data/fixture/pricebook';
import { estimateCost } from '../../src/domain/cost';
import { BY_ID, NOW, buildWith, selfHosted } from './scenarios';

describe('compute and storage projection precision', () => {
  it.each(['gpu_hour', 'cpu_hour'] as const)(
    'preserves fractional %s usage instead of rounding it to zero',
    (meter) => {
      const build = selfHosted();
      build.selections = build.selections.map((s) =>
        s.kind === 'compute_profile'
          ? { ...s, settings: { instances: 1, reserved_hours_per_month: 0.0000001 } }
          : s,
      );
      const pricebook = {
        ...DEMO_PRICEBOOK,
        rates: DEMO_PRICEBOOK.rates
          .filter((r) => r.id === 'rate.demo.nimbus-1x-c24.gpu')
          .map((r) => ({ ...r, meter, unit_price: { amount: '1000000', currency: 'USD' } })),
      };
      assertContract('BuildSnapshot', build);
      const cost = assertContract(
        'CostEstimate',
        estimateCost(build, BY_ID, pricebook, { now: NOW }),
      );
      expect(cost.line_items[0]?.quantity).toBe('0.0000001');
      expect(cost.line_items[0]?.amount.amount).toBe('0.10');
    },
  );

  it('preserves large safe integer products for GPU hours', () => {
    const build = selfHosted();
    build.selections = build.selections.map((s) =>
      s.kind === 'compute_profile'
        ? { ...s, settings: { instances: 1_000_000_001, reserved_hours_per_month: 1_000_000_001 } }
        : s,
    );
    const cost = estimateCost(build, BY_ID, DEMO_PRICEBOOK, { now: NOW });
    const line = cost.line_items.find((l) => l.meter === 'gpu_hour');
    expect(line?.quantity).toBe('1000000002000000001');
    expect(line?.amount.amount).toBe('1100000002200000001.10');
  });

  it('preserves small provisioned storage quantities', () => {
    const build = buildWith([
      ['workload', 'support-chat'],
      ['storage', 'object'],
    ]);
    build.selections = build.selections.map((s) =>
      s.kind === 'storage' ? { ...s, settings: { provisioned_gb: 0.0000001 } } : s,
    );
    const pricebook = {
      ...DEMO_PRICEBOOK,
      rates: DEMO_PRICEBOOK.rates
        .filter((r) => r.id === 'rate.demo.storage-object')
        .map((r) => ({ ...r, unit_price: { amount: '1000000', currency: 'USD' } })),
    };
    assertContract('BuildSnapshot', build);
    const cost = assertContract(
      'CostEstimate',
      estimateCost(build, BY_ID, pricebook, { now: NOW }),
    );
    expect(cost.line_items[0]?.quantity).toBe('0.0000001');
    expect(cost.line_items[0]?.amount.amount).toBe('0.10');
  });

  it('leaves usage below the supported precision unpriced instead of zero', () => {
    const build = selfHosted();
    build.selections = build.selections.map((s) =>
      s.kind === 'compute_profile'
        ? { ...s, settings: { instances: 1, reserved_hours_per_month: 1e-13 } }
        : s,
    );
    const cost = estimateCost(build, BY_ID, DEMO_PRICEBOOK, { now: NOW });
    expect(cost.unpriced_selection_ids).toContain('sel_compute_profile');
    expect(cost.line_items.find((l) => l.meter === 'gpu_hour')).toBeUndefined();
  });

  it('rounds prorated usage to twelve fractional places', () => {
    const build = selfHosted();
    build.selections = build.selections.map((s) =>
      s.kind === 'compute_profile'
        ? { ...s, settings: { instances: 1, reserved_hours_per_month: 1 } }
        : s,
    );
    const cost = estimateCost(build, BY_ID, DEMO_PRICEBOOK, { now: NOW, periodDays: 1 });
    expect(cost.line_items.find((l) => l.meter === 'gpu_hour')?.quantity).toBe('0.033333333333');
  });

  it('leaves a nonzero proration below contract precision unpriced', () => {
    const build = selfHosted();
    build.selections = build.selections.map((s) =>
      s.kind === 'compute_profile'
        ? { ...s, settings: { instances: 1, reserved_hours_per_month: 1e-12 } }
        : s,
    );
    const cost = estimateCost(build, BY_ID, DEMO_PRICEBOOK, { now: NOW, periodDays: 1 });
    expect(cost.unpriced_selection_ids).toContain('sel_compute_profile');
    expect(cost.line_items.find((l) => l.meter === 'gpu_hour')).toBeUndefined();
  });

  it('rounds a half-unit at contract precision up', () => {
    const build = selfHosted();
    build.selections = build.selections.map((s) =>
      s.kind === 'compute_profile'
        ? { ...s, settings: { instances: 1, reserved_hours_per_month: 1e-12 } }
        : s,
    );
    const cost = estimateCost(build, BY_ID, DEMO_PRICEBOOK, { now: NOW, periodDays: 15 });
    expect(cost.line_items.find((l) => l.meter === 'gpu_hour')?.quantity).toBe('0.000000000001');
  });

  it('leaves an unsafe imported GPU count unpriced without throwing', () => {
    const build = selfHosted();
    build.selections = build.selections.map((s) =>
      s.kind === 'compute_profile'
        ? { ...s, settings: { instances: 10_000_000_000_000_000, reserved_hours_per_month: 720 } }
        : s,
    );
    assertContract('BuildSnapshot', build);
    const cost = estimateCost(build, BY_ID, DEMO_PRICEBOOK, { now: NOW });
    expect(cost.unpriced_selection_ids).toContain('sel_compute_profile');
    expect(cost.line_items.find((l) => l.meter === 'gpu_hour')).toBeUndefined();
  });

  it('retains small training GPU budgets', () => {
    const build = buildWith([
      ['workload', 'support-chat'],
      ['training_compute', 'nimbus-burst'],
    ]);
    build.selections = build.selections.map((s) =>
      s.kind === 'training_compute' ? { ...s, settings: { gpu_hours_budget: 1e-7 } } : s,
    );
    assertContract('BuildSnapshot', build);
    const cost = assertContract(
      'CostEstimate',
      estimateCost(build, BY_ID, DEMO_PRICEBOOK, { now: NOW }),
    );
    expect(cost.line_items.find((l) => l.meter === 'gpu_hour')?.quantity).toBe('0.0000001');
  });
});
