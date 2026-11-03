import type { CatalogItem, Selection } from '../contracts';

/** Version replacement resets settings; ask before discarding them. */
export function confirmVersionReplacement(
  selection: Selection | undefined,
  item: CatalogItem,
): boolean {
  if (
    !selection ||
    selection.catalog_item_id !== item.id ||
    selection.catalog_item_version === item.version
  )
    return true;
  const objectives = item.kind === 'workload' ? ' It may also update workload objectives.' : '';
  return window.confirm(
    `Selecting the current version of ${item.name} will reset this component's settings to defaults.${objectives} Continue?`,
  );
}
