import { describe, expect, it } from 'vitest';
import { formatAmount, formatExactMoney, formatMoney } from '../../src/lib/item-cost';

describe('contract decimal money formatting', () => {
  it('rounds display amounts without binary floating point or unsafe integers', () => {
    expect(formatMoney('1.005', 'USD')).toBe('$1.01');
    expect(formatMoney('9007199254740993.12', 'USD')).toBe('$9,007,199,254,740,993.12');
    expect(formatMoney('3', 'JPY')).toBe('¥3');
    expect(formatAmount('9007199254740993', 'USD')).toBe('$9,007,199,254,740,993');
    expect(formatAmount('1.005', 'USD')).toBe('$1.01');
  });

  it('preserves sub-cent differences and the full contract precision', () => {
    expect(formatExactMoney('0.005', 'USD')).toBe('$0.005');
    expect(formatExactMoney('1.000000000001', 'USD')).toBe('$1.000000000001');
    expect(formatExactMoney('10000000000000000.01', 'USD')).toBe('$10,000,000,000,000,000.01');
    expect(formatExactMoney('3', 'JPY')).toBe('¥3');
  });
});
