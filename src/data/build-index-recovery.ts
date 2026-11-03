import { DataError, isDataError } from './errors';
import type { KeyValueStorage } from './local-builds';

const INDEX_KEY = 'pyai.builds.index';
const BUILD_PREFIX = 'pyai.build.';

/** Recover unindexed records without modifying builds or dropping existing index entries. */
export function rebuildBuildIndex(storage: KeyValueStorage): number {
  try {
    const original = storage.getItem(INDEX_KEY);
    let existing: string[] | null = null;
    if (original !== null) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(original);
      } catch {
        parsed = null;
      }
      if (Array.isArray(parsed) && parsed.every((id): id is string => typeof id === 'string'))
        existing = parsed;
    }

    const scan = (): string[] => {
      if (typeof storage.length !== 'number' || !storage.key) {
        throw new DataError('unsupported', 'This storage does not support listing saved records.');
      }
      const count = storage.length;
      const keys: string[] = [];
      for (let i = 0; i < count; i++) {
        const key = storage.key(i);
        if (key === null)
          throw new DataError('conflict', 'Browser storage changed during recovery.');
        keys.push(key);
      }
      if (storage.length !== count || new Set(keys).size !== count) {
        throw new DataError('conflict', 'Browser storage changed during recovery.');
      }
      return keys.sort();
    };
    const first = scan();
    const second = scan();
    if (
      JSON.stringify(first) !== JSON.stringify(second) ||
      storage.getItem(INDEX_KEY) !== original
    ) {
      throw new DataError('conflict', 'Browser storage changed during recovery. Please retry.');
    }
    const ids = first
      .filter((key) => key.startsWith(BUILD_PREFIX))
      .map((key) => key.slice(BUILD_PREFIX.length));

    const existingIds = new Set(existing ?? []);
    const missing = ids.filter((id) => !existingIds.has(id));
    if (existing && missing.length === 0) return ids.length;
    const recovered = existing ? [...existing, ...missing] : ids;

    if (original !== null) {
      let number = 1;
      while (storage.getItem(`${INDEX_KEY}.backup.${number}`) !== null) number++;
      storage.setItem(`${INDEX_KEY}.backup.${number}`, original);
    }
    const finalIds = scan()
      .filter((key) => key.startsWith(BUILD_PREFIX))
      .map((key) => key.slice(BUILD_PREFIX.length));
    if (
      storage.getItem(INDEX_KEY) !== original ||
      JSON.stringify(finalIds) !== JSON.stringify(ids)
    ) {
      throw new DataError('conflict', 'Saved builds changed during recovery. Please retry.');
    }
    storage.setItem(INDEX_KEY, JSON.stringify(recovered));
    return ids.length;
  } catch (cause) {
    if (isDataError(cause)) throw cause;
    throw new DataError(
      'unsupported',
      'Browser storage is full or unavailable; the index was not rebuilt.',
      { cause },
    );
  }
}
