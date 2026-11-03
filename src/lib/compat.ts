/*
 * Per-candidate compatibility, keyed for catalog UIs.
 *
 * `compatibleOptions(build, kind)` answers "what would happen to the current build if this catalog
 * item were the selection for this kind" — exactly what a component card or catalog row needs.
 * Verdicts are the contract's three-valued `compatible | incompatible | unknown`; unknown is never
 * treated as compatible. The failing rule ids are kept so a card can say *why*, not just that.
 */
import { useQueries } from '@tanstack/react-query';
import { kindDef, type BuildSnapshot, type ComponentKind } from '../contracts';
import { nextRole } from '../domain/build';
import type { CompatibleOption } from '../data/types';
import { useData } from '../app/data-context';

export type CompatOption = CompatibleOption;
export type VerdictMap = ReadonlyMap<string, CompatOption>;

export const verdictKey = (kind: ComponentKind, itemId: string, version: string) =>
  JSON.stringify([kind, itemId, version]);

/** An ambiguous response is not evidence for a particular catalog version. */
export function uniqueOptionFor(
  options: readonly CompatibleOption[] | undefined,
  itemId: string,
  version: string,
): CompatibleOption | undefined {
  const matches = options?.filter(
    (option) => option.catalog_item_id === itemId && option.catalog_item_version === version,
  );
  return matches?.length === 1 ? matches[0] : undefined;
}

/** Independent kind queries retain successful verdicts while failed kinds can retry. */
export function useCompatByKind(
  build: BuildSnapshot | null | undefined,
  kinds: ComponentKind[],
  options: { role?: string; additional?: boolean } = {},
) {
  const { compatibility } = useData();
  const unique = [...new Set(kinds)];
  const roles = unique.map(
    (kind) =>
      options.role ??
      (build && options.additional && kindDef(kind).cardinality === 'many'
        ? nextRole(build, kind)
        : 'primary'),
  );
  const queries = useQueries({
    queries: unique.map((kind, index) => ({
      queryKey: [
        'compat-kind',
        build?.id ?? 'none',
        build?.revision ?? 0,
        build ?? null,
        kind,
        roles[index],
      ],
      queryFn: () => compatibility.compatibleOptions(build!, kind, roles[index]),
      enabled: Boolean(build),
    })),
  });
  const map = new Map<string, CompatOption>();
  const ambiguous = new Set<string>();
  queries.forEach((query, index) => {
    if (query.isError || query.isPlaceholderData) return;
    for (const option of query.data ?? []) {
      const key = verdictKey(unique[index]!, option.catalog_item_id, option.catalog_item_version);
      if (ambiguous.has(key)) continue;
      if (map.has(key)) {
        map.delete(key);
        ambiguous.add(key);
      } else {
        map.set(key, option);
      }
    }
  });
  const failed = queries.filter((query) => query.isError);
  return {
    data: map as VerdictMap,
    isSuccess: queries.length > 0 && queries.every((query) => query.isSuccess),
    isError: failed.length > 0,
    error: failed[0]?.error ?? null,
    refetch: () => Promise.all(failed.map((query) => query.refetch())),
  };
}

/** Verdict for one item, defaulting to `unknown` while the evaluation is in flight. */
export function verdictFor(
  map: VerdictMap | undefined,
  kind: ComponentKind,
  itemId: string,
  version: string,
) {
  return map?.get(verdictKey(kind, itemId, version))?.verdict ?? 'unknown';
}

/** Full option (verdict + failing rule ids) for one item, if it has been evaluated. */
export function optionFor(
  map: VerdictMap | undefined,
  kind: ComponentKind,
  itemId: string,
  version: string,
) {
  return map?.get(verdictKey(kind, itemId, version));
}
