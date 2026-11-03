import type { BuildSnapshot, CostEstimate } from '../contracts';
import { EvaluationNumber } from '../domain/evaluation-number';
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

/** Compare reported totals without floating-point conversion or rounding. */
export function hasConsistentCostTotals(cost: CostEstimate): boolean {
  const subtotal = EvaluationNumber.from(cost.subtotal.amount);
  const tax = EvaluationNumber.from(cost.tax.amount);
  const total = EvaluationNumber.from(cost.total.amount);
  return (
    subtotal !== null && tax !== null && total !== null && subtotal.add(tax).compare(total) === 0
  );
}

/** Complete coverage cannot simultaneously identify unpriced selections. */
export function hasCoherentCostCoverage(cost: CostEstimate): boolean {
  return cost.coverage !== 'complete' || cost.unpriced_selection_ids.length === 0;
}

/** Every priced or unpriced selection must belong to the requested build. */
export function hasKnownCostSelections(
  cost: CostEstimate,
  selectionIds: ReadonlySet<string>,
): boolean {
  return (
    cost.line_items.every((line) => selectionIds.has(line.selection_id)) &&
    cost.unpriced_selection_ids.every((id) => selectionIds.has(id))
  );
}

/** Admit 30-day estimates only for the requested build and pricebook, in one currency. */
export async function estimateBuildCost(
  pricing: PricingProvider,
  build: BuildSnapshot,
): Promise<CostEstimate> {
  const context = { id: build.id, revision: build.revision, locks: { ...build.locks } };
  const selectionIds = new Set(build.selections.map((selection) => selection.id));
  const cost = await pricing.estimate(build, 30);
  if (!matchesCostEvidence(context, cost))
    throw new DataError(
      'malformed',
      'Cost estimate does not match the build revision or pricebook.',
      {
        contract: 'CostEstimate',
      },
    );
  if (cost.period_days !== 30)
    throw new DataError('malformed', 'Cost estimate does not match the requested 30-day period.', {
      contract: 'CostEstimate',
    });
  if (!hasConsistentCostCurrency(cost))
    throw new DataError('malformed', 'Cost estimate contains inconsistent currencies.', {
      contract: 'CostEstimate',
    });
  if (!hasConsistentCostTotals(cost))
    throw new DataError('malformed', 'Cost estimate total does not equal subtotal plus tax.', {
      contract: 'CostEstimate',
    });
  if (!hasCoherentCostCoverage(cost))
    throw new DataError('malformed', 'A complete cost estimate lists unpriced selections.', {
      contract: 'CostEstimate',
    });
  if (!hasKnownCostSelections(cost, selectionIds))
    throw new DataError('malformed', 'Cost estimate references selections outside this build.', {
      contract: 'CostEstimate',
    });
  return cost;
}
