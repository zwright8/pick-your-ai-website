import type { BuildSnapshot } from '../contracts';
import { isComponentKind, validateContract } from '../contracts';
import { DataError } from './errors';
import type { StoredBuild } from './types';

/** Drafts with fewer than two selections are not yet schema-valid snapshots; validate the rest. */
export function validateDraftBuild(build: unknown): string | null {
  if (!build || typeof build !== 'object') return 'not an object';
  const b = build as BuildSnapshot;
  const candidate =
    Array.isArray(b.selections) && b.selections.length < 2
      ? { ...b, selections: [...b.selections, ...PLACEHOLDER_SELECTIONS].slice(0, 2) }
      : b;
  const result = validateContract('BuildSnapshot', candidate);
  return result.ok ? null : result.summary;
}

const PLACEHOLDER_SELECTIONS = [
  {
    id: 'sel_placeholder_a',
    kind: 'workload',
    catalog_item_id: 'placeholder.item',
    catalog_item_version: '0',
    role: 'placeholder-a',
    enabled: false,
    settings: {},
  },
  {
    id: 'sel_placeholder_b',
    kind: 'workload',
    catalog_item_id: 'placeholder.item',
    catalog_item_version: '0',
    role: 'placeholder-b',
    enabled: false,
    settings: {},
  },
] as const;

export function parseStoredBuild(raw: string, expectedId: string): StoredBuild {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (cause) {
    throw new DataError('malformed', 'Saved build is not valid JSON.', { cause });
  }
  const d = data as Partial<StoredBuild>;
  if (
    !d ||
    typeof d !== 'object' ||
    !d.build ||
    !Array.isArray(d.revisions) ||
    !Array.isArray(d.changes)
  ) {
    throw new DataError('malformed', 'Saved build record is incomplete.');
  }
  const problem = validateStoredBuild({
    build: d.build,
    revisions: d.revisions,
    changes: d.changes,
  });
  if (problem) throw new DataError('malformed', `Saved build is invalid: ${problem}`);
  if (d.build.id !== expectedId) {
    throw new DataError('malformed', 'The saved build does not match its storage ID.');
  }
  return d as StoredBuild;
}

/** Validate retained history before it can be rendered, compared, or restored. */
export function validateStoredBuild(value: StoredBuild): string | null {
  const headProblem = validateDraftBuild(value.build);
  if (headProblem) return headProblem;
  if (!Array.isArray(value.revisions) || !Array.isArray(value.changes))
    return 'history is incomplete';
  let previousRevision = 0;
  for (const revision of value.revisions) {
    const problem = validateDraftBuild(revision);
    if (problem) return `invalid history revision: ${problem}`;
    if (revision.id !== value.build.id || revision.revision > value.build.revision) {
      return 'history revision does not belong to this build';
    }
    if (revision.revision <= previousRevision) return 'history revisions are not in order';
    previousRevision = revision.revision;
  }
  const historyHead = value.revisions.at(-1);
  if (!historyHead || !samePersistedValue(historyHead, value.build))
    return 'history does not match the current build';
  let previousChange = 0;
  for (const change of value.changes) {
    if (
      !change ||
      typeof change !== 'object' ||
      !Number.isInteger(change.revision) ||
      change.revision <= previousChange ||
      change.revision > value.build.revision ||
      typeof change.at !== 'string' ||
      typeof change.summary !== 'string' ||
      !Array.isArray(change.changedKinds) ||
      !change.changedKinds.every((kind) => typeof kind === 'string' && isComponentKind(kind))
    )
      return 'history change is invalid';
    previousChange = change.revision;
  }
  return null;
}

/** Read only a valid current snapshot from a damaged record; never alter its history. */
export function parseRecoverableHead(raw: string, expectedId: string): BuildSnapshot {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (cause) {
    throw new DataError(
      'malformed',
      'The saved record is not valid JSON and cannot be recovered.',
      { cause },
    );
  }
  if (!value || typeof value !== 'object' || !('build' in value)) {
    throw new DataError('malformed', 'The saved record has no current build to recover.');
  }
  const head = value.build;
  const problem = validateDraftBuild(head);
  if (problem)
    throw new DataError('malformed', `The current build cannot be recovered: ${problem}`);
  const build = head as BuildSnapshot;
  if (build.id !== expectedId) {
    throw new DataError('malformed', 'The current build does not match the saved record ID.');
  }
  return build;
}

/** Compare JSON values without treating object key order as significant. */
function sameJsonValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, i) => sameJsonValue(item, b[i]))
    );
  }
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (
    Object.getPrototypeOf(a) !== Object.prototype ||
    Object.getPrototypeOf(b) !== Object.prototype
  )
    return false;
  const aa = a as Record<string, unknown>;
  const bb = b as Record<string, unknown>;
  const keys = Object.keys(aa);
  return (
    keys.length === Object.keys(bb).length &&
    keys.every((key) => Object.hasOwn(bb, key) && sameJsonValue(aa[key], bb[key]))
  );
}

function samePersistedValue(a: unknown, b: unknown): boolean {
  try {
    const left = JSON.stringify(a);
    const right = JSON.stringify(b);
    if (left === undefined || right === undefined) return false;
    return sameJsonValue(JSON.parse(left), JSON.parse(right));
  } catch {
    return false;
  }
}

export function sameStoredRecord(left: StoredBuild, right: StoredBuild): boolean {
  return samePersistedValue(left, right);
}
