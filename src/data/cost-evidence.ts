import type { CostEstimate } from '../contracts';

/** A total and its components cannot be compared as one currency when their units disagree. */
export function hasConsistentCostCurrency(cost: CostEstimate): boolean {
  return (
    cost.subtotal.currency === cost.currency &&
    cost.tax.currency === cost.currency &&
    cost.total.currency === cost.currency &&
    cost.line_items.every(
      (line) =>
        line.amount.currency === cost.currency && line.unit_price.currency === cost.currency,
    )
  );
}
