/*
 * Browser-local build repository (My Builds). Drafts live only in this browser's localStorage;
 * nothing is sent anywhere. Each stored record is validated on read; corrupt records are reported,
 * not silently dropped or "repaired".
 */
import { validatorsReady } from '../contracts';
import {
  parseRecoverableHead,
  parseStoredBuild,
  sameStoredRecord,
  validateStoredBuild,
} from './build-record';
import { rebuildBuildIndex } from './build-index-recovery';
import { DataError, isDataError } from './errors';
import { withBuildStorageLock } from './storage-lock';
import { compareNewestRecordedDates } from '../domain/date-time';
import type { BuildRepository, SavedBuildSummary, StoredBuild } from './types';

const PREFIX = 'pyai.build.';
const INDEX_KEY = 'pyai.builds.index';

export interface KeyValueStorage {
  readonly length?: number;
  key?(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function unavailableStorage(cause?: unknown): KeyValueStorage {
  const unavailable = (): never => {
    throw new DataError('unsupported', 'Browser storage is unavailable. Builds cannot be saved.', {
      cause,
    });
  };
  return { getItem: unavailable, setItem: unavailable, removeItem: unavailable };
}

export function defaultStorage(): KeyValueStorage {
  try {
    return typeof localStorage === 'undefined' ? unavailableStorage() : localStorage;
  } catch (cause) {
    return unavailableStorage(cause);
  }
}

type WriteMode =
  { kind: 'local'; expectedRevision: number | null } | { kind: 'remote'; snapshot: string | null };

export class LocalBuildRepository implements BuildRepository {
  private readonly storage: KeyValueStorage;
  private readonly deleteSnapshots = new Map<string, { raw: string; token: string }>();
  private nextDeleteToken = 0;
  constructor(storage: KeyValueStorage = defaultStorage()) {
    this.storage = storage;
  }

  private index(): string[] {
    const raw = this.storage.getItem(INDEX_KEY);
    if (raw === null) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (cause) {
      throw new DataError(
        'malformed',
        'The saved-build index is unreadable. Stored builds have not been changed.',
        { cause },
      );
    }
    if (!Array.isArray(parsed) || !parsed.every((id) => typeof id === 'string')) {
      throw new DataError(
        'malformed',
        'The saved-build index is invalid. Stored builds have not been changed.',
      );
    }
    return parsed;
  }

  private writeIndex(ids: string[]) {
    const updated = JSON.stringify([...new Set(ids)]);
    try {
      this.storage.setItem(INDEX_KEY, updated);
    } catch (cause) {
      throw new DataError('unsupported', 'Browser storage is full or unavailable.', { cause });
    }
    return updated;
  }

  private rollbackIndex(previous: string | null, expected: string, cause: unknown): never {
    try {
      if (this.storage.getItem(INDEX_KEY) !== expected) {
        throw new Error('Saved-build index changed while the operation was in progress.');
      }
      if (previous === null) this.storage.removeItem(INDEX_KEY);
      else this.storage.setItem(INDEX_KEY, previous);
    } catch (rollbackCause) {
      throw new DataError(
        'unsupported',
        'Browser storage failed, and the saved-build index could not be restored. Stored records may need recovery.',
        { cause: new AggregateError([cause, rollbackCause]) },
      );
    }
    if (isDataError(cause) && cause.kind === 'conflict') throw cause;
    throw new DataError('unsupported', 'Browser storage is full or unavailable.', { cause });
  }

  async list(): Promise<SavedBuildSummary[]> {
    await validatorsReady;
    return withBuildStorageLock(() => this.listUnlocked());
  }

  private listUnlocked(): SavedBuildSummary[] {
    const out: SavedBuildSummary[] = [];
    const seen = new Set<string>();
    for (const id of this.index()) {
      if (seen.has(id)) continue;
      const raw = this.storage.getItem(PREFIX + id);
      if (raw === null) continue;
      seen.add(id);
      let snapshot = this.deleteSnapshots.get(id);
      if (!snapshot || snapshot.raw !== raw) {
        snapshot = { raw, token: String(++this.nextDeleteToken) };
        this.deleteSnapshots.set(id, snapshot);
      }
      try {
        const { build } = parseStoredBuild(raw, id);
        out.push({
          id: build.id,
          name: build.name,
          revision: build.revision,
          updatedAt: build.updated_at,
          selectionCount: build.selections.length,
          deleteToken: snapshot.token,
        });
      } catch {
        out.push({
          id,
          name: '(unreadable saved build)',
          revision: 0,
          updatedAt: '',
          selectionCount: 0,
          deleteToken: snapshot.token,
        });
      }
    }
    for (const id of this.deleteSnapshots.keys()) {
      if (!seen.has(id)) this.deleteSnapshots.delete(id);
    }
    return out.sort((a, b) => compareNewestRecordedDates(a.updatedAt, b.updatedAt));
  }

  async get(buildId: string): Promise<StoredBuild> {
    await validatorsReady;
    return withBuildStorageLock(() => {
      const raw = this.storage.getItem(PREFIX + buildId);
      if (raw === null)
        throw new DataError('not_found', `No saved build ${buildId} in this browser.`);
      return parseStoredBuild(raw, buildId);
    });
  }

  async rebuildIndex(): Promise<number> {
    return withBuildStorageLock(() => rebuildBuildIndex(this.storage));
  }

  async recoverHead(buildId: string) {
    await validatorsReady;
    return withBuildStorageLock(() => {
      const raw = this.storage.getItem(PREFIX + buildId);
      if (raw === null)
        throw new DataError('not_found', `No saved build ${buildId} in this browser.`);
      return parseRecoverableHead(raw, buildId);
    });
  }

  async save(stored: StoredBuild, expectedRevision: number | null): Promise<StoredBuild> {
    const submitted = structuredClone(stored);
    await validatorsReady;
    return withBuildStorageLock(() => this.write(submitted, { kind: 'local', expectedRevision }));
  }

  /** Capture the local mirror before dispatching a remote write. */
  remoteCacheSnapshot(buildId: string): string | null {
    return this.storage.getItem(PREFIX + buildId);
  }

  /** Update the mirror only if it has not changed since the remote write was sent. */
  async cacheRemote(stored: StoredBuild, snapshot: string | null): Promise<StoredBuild> {
    const submitted = structuredClone(stored);
    await validatorsReady;
    return withBuildStorageLock(() => this.write(submitted, { kind: 'remote', snapshot }));
  }

  private write(stored: StoredBuild, mode: WriteMode): StoredBuild {
    const problem = validateStoredBuild(stored);
    if (problem) throw new DataError('malformed', `Refusing to save an invalid build: ${problem}`);
    const id = stored.build.id;
    const ids = this.index();
    const raw = this.storage.getItem(PREFIX + id);
    if (mode.kind === 'remote') {
      if (raw !== mode.snapshot) {
        if (raw !== null && ids.includes(id)) {
          const current = parseStoredBuild(raw, id);
          if (current.build.revision === stored.build.revision && sameStoredRecord(current, stored))
            return current;
        }
        throw new DataError(
          'conflict',
          'The local cache changed while the remote save was in progress.',
          { status: 409 },
        );
      }
      if (raw !== null) {
        const current = parseStoredBuild(raw, id);
        if (current.build.revision === stored.build.revision && sameStoredRecord(current, stored)) {
          if (!ids.includes(id)) this.writeIndex([id, ...ids]);
          return current;
        }
        if (current.build.revision >= stored.build.revision) {
          throw new DataError('conflict', 'The local cache has an equal or newer revision.', {
            status: 409,
          });
        }
      }
    } else {
      const expectedRevision = mode.expectedRevision;
      if (raw !== null && expectedRevision === null) {
        throw new DataError(
          'conflict',
          'A build with this ID already exists. Your changes have not been saved.',
          { status: 409 },
        );
      }
      if (raw === null && expectedRevision !== null) {
        throw new DataError(
          'conflict',
          'This build no longer exists in this browser. Your changes have not been saved.',
          { status: 409 },
        );
      }
      if (raw !== null && expectedRevision !== null) {
        const current = parseStoredBuild(raw, id).build.revision;
        if (current !== expectedRevision) {
          throw new DataError(
            'conflict',
            `This build was changed in another tab (revision ${current}); reload it before saving.`,
            { status: 409 },
          );
        }
      }
    }
    const needsIndexUpdate = !ids.includes(id);
    const previousIndex = needsIndexUpdate ? this.storage.getItem(INDEX_KEY) : null;
    const updatedIndex = needsIndexUpdate ? this.writeIndex([id, ...ids]) : null;
    try {
      this.storage.setItem(PREFIX + id, JSON.stringify(stored));
    } catch (cause) {
      if (updatedIndex !== null) this.rollbackIndex(previousIndex, updatedIndex, cause);
      throw new DataError('unsupported', 'Browser storage is full or unavailable.', { cause });
    }
    return stored;
  }

  async remove(buildId: string, deleteToken?: string): Promise<void> {
    return withBuildStorageLock(() => this.removeUnlocked(buildId, deleteToken));
  }

  private removeUnlocked(buildId: string, deleteToken?: string): void {
    // Non-cooperating tabs or browsers without Web Locks can still change storage.
    const ids = this.index();
    const snapshot = deleteToken === undefined ? undefined : this.deleteSnapshots.get(buildId);
    const conflict = () =>
      new DataError(
        'conflict',
        'This saved build changed. Review the latest version before deleting it.',
      );
    if (
      deleteToken !== undefined &&
      (!snapshot ||
        snapshot.token !== deleteToken ||
        !ids.includes(buildId) ||
        this.storage.getItem(PREFIX + buildId) !== snapshot.raw)
    )
      throw conflict();
    const previousIndex = this.storage.getItem(INDEX_KEY);
    const updatedIndex = this.writeIndex(ids.filter((x) => x !== buildId));
    try {
      if (snapshot && this.storage.getItem(PREFIX + buildId) !== snapshot.raw) throw conflict();
      this.storage.removeItem(PREFIX + buildId);
      this.deleteSnapshots.delete(buildId);
    } catch (cause) {
      this.rollbackIndex(previousIndex, updatedIndex, cause);
    }
  }
}
