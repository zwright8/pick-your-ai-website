import type { BuildSnapshot, CostEstimate } from '../contracts';
import { matchesCostEvidence } from './evidence-context';
import { DataError } from './errors';
import type { PricingProvider } from './types';

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

/** Admit provider estimates only for the requested build and explicit pricebook, in one currency. */
export async function estimateBuildCost(
  pricing: PricingProvider,
  build: BuildSnapshot,
): Promise<CostEstimate> {
  const context = { id: build.id, revision: build.revision, locks: { ...build.locks } };
  const cost = await pricing.estimate(build);
  if (!matchesCostEvidence(context, cost))
    throw new DataError(
      'malformed',
      'Cost estimate does not match the build revision or pricebook.',
      {
        contract: 'CostEstimate',
      },
    );
  if (!hasConsistentCostCurrency(cost))
    throw new DataError('malformed', 'Cost estimate contains inconsistent currencies.', {
      contract: 'CostEstimate',
    });
  return cost;
}
