import type { BuildSnapshot, CostEstimate, ResourceEstimate } from '../contracts';

type ResourceEntry = ResourceEstimate['estimates'][number];

const RESOURCE_UNITS = {
  'inference.estimated_required_vram_gb': 'gb',
  'inference.estimated_peak_per_device_vram_gb': 'gb',
  'inference.estimated_tokens_per_second': 'tokens_per_second',
  'compute.estimated_gpu_power_w': 'watt',
  'training.estimated_gpu_hours': 'gpu_hour',
} as const satisfies Record<ResourceEntry['metric'], ResourceEntry['unit']>;

/** The schema enumerates units independently; each metric still requires its stated unit. */
export function hasConsistentResourceUnits(resource: ResourceEstimate): boolean {
  return resource.estimates.every((entry) => RESOURCE_UNITS[entry.metric] === entry.unit);
}

/** Every referenced selection must exist in the build revision being evaluated. */
export function hasKnownResourceSelections(
  resource: ResourceEstimate,
  selectionIds: ReadonlySet<string>,
): boolean {
  return (
    resource.estimates.length > 0 &&
    resource.estimates.every(
      (entry) =>
        entry.selection_ids.length > 0 &&
        entry.selection_ids.every((selectionId) => selectionIds.has(selectionId)),
    )
  );
}

/** Admit evidence only for the build revision it describes. */
export function matchesBuildEvidence(
  build: BuildSnapshot,
  evidence: { readonly build_id: string; readonly build_revision: number },
): boolean {
  return evidence.build_id === build.id && evidence.build_revision === build.revision;
}

/** An explicit pricebook lock also binds cost evidence to that pricebook. */
export function matchesCostEvidence(build: BuildSnapshot, cost: CostEstimate): boolean {
  return (
    matchesBuildEvidence(build, cost) &&
    (!build.locks.pricebook_id || cost.pricebook_id === build.locks.pricebook_id)
  );
}
