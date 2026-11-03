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

const CONFIDENCE_RANK = { unverified: 0, estimated: 1, calibrated: 2, verified: 3 } as const;

/** Multiple qualified estimates cannot be reduced to a single metric without choosing arbitrarily. */
export function ambiguousResourceMetrics(
  build: Pick<BuildSnapshot, 'policy'>,
  resource: ResourceEstimate,
): ReadonlySet<ResourceEntry['metric']> {
  const minimum = CONFIDENCE_RANK[build.policy?.min_resource_confidence ?? 'calibrated'];
  const seen = new Set<ResourceEntry['metric']>();
  const ambiguous = new Set<ResourceEntry['metric']>();
  for (const entry of resource.estimates) {
    if (CONFIDENCE_RANK[entry.confidence] < minimum) continue;
    if (seen.has(entry.metric)) ambiguous.add(entry.metric);
    seen.add(entry.metric);
  }
  return ambiguous;
}

/** Avoid the local reference interpreter's first-qualified-value behavior when evidence is ambiguous. */
export function unambiguousResourceEvidence(
  build: Pick<BuildSnapshot, 'policy'>,
  resource: ResourceEstimate,
): ResourceEstimate | null {
  const ambiguous = ambiguousResourceMetrics(build, resource);
  if (!ambiguous.size) return resource;
  const estimates = resource.estimates.filter((entry) => !ambiguous.has(entry.metric));
  return estimates.length ? { ...resource, estimates } : null;
}

/** Admit evidence only for the build revision it describes. */
export function matchesBuildEvidence(
  build: Pick<BuildSnapshot, 'id' | 'revision'>,
  evidence: { readonly build_id: string; readonly build_revision: number },
): boolean {
  return evidence.build_id === build.id && evidence.build_revision === build.revision;
}

/** An explicit pricebook lock also binds cost evidence to that pricebook. */
export function matchesCostEvidence(
  build: Pick<BuildSnapshot, 'id' | 'revision' | 'locks'>,
  cost: CostEstimate,
): boolean {
  return (
    matchesBuildEvidence(build, cost) &&
    (!build.locks.pricebook_id || cost.pricebook_id === build.locks.pricebook_id)
  );
}
