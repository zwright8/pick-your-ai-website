import type { BuildSnapshot, CostEstimate } from '../contracts';

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
