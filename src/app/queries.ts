/*
 * TanStack Query hooks. Build-derived keys include the snapshot content as well as its ID and
 * revision, so accepted changes at the same revision cannot reuse earlier analysis. Previous cost/report data is kept as
 * an explicitly flagged stale placeholder; capacity evidence is hidden until it is current.
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { BuildSnapshot, CatalogItem, ComponentKind } from '../contracts';
import { estimateBuildCost } from '../data/cost-evidence';
import { hasConsistentResourceUnits, hasKnownResourceSelections } from '../data/evidence-context';
import { DataError } from '../data/errors';
import { evaluateBuild } from '../data/evaluation-evidence';
import { useData } from './data-context';

export function useCatalog() {
  const { catalog } = useData();
  const q = useQuery({
    queryKey: ['catalog', 'snapshot'],
    queryFn: () => catalog.getSnapshot(),
    staleTime: Infinity,
  });
  const byId = useMemo(
    () => new Map<string, CatalogItem>((q.data?.items ?? []).map((i) => [i.id, i])),
    [q.data],
  );
  return { ...q, byId };
}

export function useGraph() {
  const { catalog } = useData();
  return useQuery({
    queryKey: ['catalog', 'graph'],
    queryFn: () => catalog.getDependencyGraph(),
    staleTime: Infinity,
  });
}

export function useRuleset() {
  const { catalog } = useData();
  return useQuery({
    queryKey: ['catalog', 'ruleset'],
    queryFn: () => catalog.getRuleset(),
    staleTime: Infinity,
  });
}

export function usePricebook(id?: string) {
  const { pricing } = useData();
  return useQuery({
    queryKey: ['pricebook', id ?? 'default'],
    queryFn: () => pricing.getPricebook(id),
    staleTime: Infinity,
  });
}

const buildKey = (b: BuildSnapshot | null | undefined) =>
  [b?.id ?? 'none', b?.revision ?? 0, b ?? null] as const;

/** Cost → resources → evaluation for the exact build revision. */
export function useBuildAnalysis(build: BuildSnapshot | null | undefined) {
  const data = useData();
  const enabled = Boolean(build);
  const cost = useQuery({
    queryKey: ['cost', ...buildKey(build)],
    queryFn: () => {
      if (!build) throw new DataError('not_found', 'No build is available.');
      return estimateBuildCost(data.pricing, build);
    },
    enabled,
    placeholderData: keepPreviousData,
    retry: 1,
  });
  const resources = useQuery({
    queryKey: ['resources', ...buildKey(build)],
    queryFn: async () => {
      if (!build) throw new DataError('not_found', 'No build is available.');
      const { id, revision } = build;
      const selectionIds = new Set(build.selections.map((selection) => selection.id));
      const result = await data.resources.estimate(build);
      if (result.status === 'available') {
        if (result.estimate.build_id !== id || result.estimate.build_revision !== revision)
          throw new DataError('malformed', 'Resource evidence does not match the build revision.', {
            contract: 'ResourceEstimate',
          });
        if (!hasConsistentResourceUnits(result.estimate))
          throw new DataError(
            'malformed',
            'Resource evidence contains incompatible metric units.',
            {
              contract: 'ResourceEstimate',
            },
          );
        if (!hasKnownResourceSelections(result.estimate, selectionIds))
          throw new DataError(
            'malformed',
            'Resource evidence references selections outside this build.',
            { contract: 'ResourceEstimate' },
          );
      }
      return result;
    },
    enabled,
    placeholderData: keepPreviousData,
    retry: 1,
  });
  const costReady =
    build &&
    !cost.isError &&
    !cost.isPlaceholderData &&
    cost.data?.build_id === build.id &&
    cost.data.build_revision === build.revision;
  const resourceEstimate =
    build &&
    !resources.isError &&
    !resources.isPlaceholderData &&
    resources.data?.status === 'available' &&
    resources.data.estimate.build_id === build.id &&
    resources.data.estimate.build_revision === build.revision
      ? resources.data.estimate
      : null;
  const evaluation = useQuery({
    queryKey: ['evaluation', ...buildKey(build), costReady ? cost.data : null, resourceEstimate],
    queryFn: () => {
      if (!build) throw new DataError('not_found', 'No build is available.');
      return evaluateBuild(data.compatibility, build, {
        costEstimate: costReady ? cost.data : null,
        resourceEstimate,
      });
    },
    enabled: enabled && !cost.isPending,
    placeholderData: keepPreviousData,
    retry: 1,
  });
  const report = evaluation.data;
  const reportIsCurrent = Boolean(
    !evaluation.isError &&
    !evaluation.isPlaceholderData &&
    report &&
    build &&
    report.build_id === build.id &&
    report.build_revision === build.revision,
  );
  const costIsCurrent = Boolean(costReady);
  return {
    report,
    reportIsCurrent,
    evaluation,
    cost: cost.data,
    costIsCurrent,
    costQuery: cost,
    resources:
      build &&
      !resources.isError &&
      !resources.isPlaceholderData &&
      (resources.data?.status === 'unavailable' || resourceEstimate)
        ? resources.data
        : undefined,
    resourcesQuery: resources,
  };
}

export function useCompatibleOptions(
  build: BuildSnapshot | null | undefined,
  kind: ComponentKind,
  role = 'primary',
) {
  const { compatibility } = useData();
  return useQuery({
    queryKey: ['options', ...buildKey(build), kind, role],
    queryFn: () => compatibility.compatibleOptions(build!, kind, role),
    enabled: Boolean(build),
    placeholderData: keepPreviousData,
  });
}
