/*
 * The working build ("current draft"). Every change is committed as a new revision, persisted to
 * the BuildRepository with compare-and-swap on the previous revision, and analysed for cross-tier
 * invalidation against the contract dependency graph.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { BuildSnapshot, CatalogItem, ComponentKind } from '../contracts';
import { buildContext } from '../domain/activation';
import { type BuildDraft, commit, createBuild, createDraft } from '../domain/build';
import { affectedByChange, type InvalidationResult } from '../domain/invalidation';
import { isDataError } from '../data/errors';
import { useData } from './data-context';
import { useCatalog, useGraph } from './queries';

const CURRENT_KEY = 'pyai.currentBuildId';

export interface LastChange extends InvalidationResult {
  revision: number;
  summary: string;
}

type SaveState =
  | { status: 'idle' | 'saving' }
  | { status: 'saved'; warning?: string; retryCurrent?: () => void }
  | { status: 'error'; message: string; retry?: () => void; unsaved?: boolean };

interface SaveQueue {
  revision: number | null;
  pending: BuildDraft[];
  running: boolean;
  failed: boolean;
  detached: boolean;
}

interface PendingStart {
  intent: number;
  template?: BuildSnapshot;
  name?: string;
}

function newSaveQueue(revision: number | null): SaveQueue {
  return { revision, pending: [], running: false, failed: false, detached: false };
}

interface BuilderApi {
  draft: BuildDraft | null;
  ready: boolean;
  catalogById: ReadonlyMap<string, CatalogItem>;
  lastChange: LastChange | null;
  saveState: SaveState;
  /** Commit a change as a new revision. */
  apply: (
    change: (b: BuildSnapshot) => BuildSnapshot,
    summary: string,
    changedKinds: ComponentKind[],
    guard?: (b: BuildSnapshot) => boolean,
  ) => boolean;
  /** Start a new build (optionally from a template build) and make it current. */
  startNew: (
    template?: BuildSnapshot,
    name?: string,
    discardConfirmed?: boolean,
    deleted?: { id: string; revision: number | null },
  ) => boolean;
  open: (buildId: string, signal?: AbortSignal) => Promise<boolean>;
  /** Restore an older revision's content as a new revision. */
  restore: (revision: number) => void;
}

const BuilderContext = createContext<BuilderApi | null>(null);

function readCurrentId(): string | null {
  try {
    return localStorage.getItem(CURRENT_KEY);
  } catch {
    return null;
  }
}
function writeCurrentId(id: string): boolean {
  try {
    localStorage.setItem(CURRENT_KEY, id);
    return true;
  } catch {
    return false;
  }
}

export function BuilderProvider({ children }: { children: ReactNode }) {
  const { builds } = useData();
  const catalog = useCatalog();
  const graph = useGraph();
  const [draft, setDraft] = useState<BuildDraft | null>(null);
  const draftRef = useRef<BuildDraft | null>(null);
  const [ready, setReady] = useState(false);
  const [lastChange, setLastChange] = useState<LastChange | null>(null);
  const [saveState, setSaveState] = useState<SaveState>({ status: 'idle' });
  // Each opened draft keeps its own ordered queue, even if another draft becomes current.
  const saveQueue = useRef<SaveQueue>(newSaveQueue(null));
  const draftIntent = useRef(0);
  const pendingOpen = useRef<number | null>(null);
  const [pendingStart, setPendingStart] = useState<PendingStart | null>(null);
  const completedPendingStart = useRef<number | null>(null);
  // Set once the user starts, opens or changes a build, so a slow initial load never overwrites it.
  const touched = useRef(false);
  const catalogById = catalog.byId;
  const snapshotId = catalog.data?.id;

  const warnPendingSave = useCallback((event: BeforeUnloadEvent) => {
    if (saveQueue.current.pending.length) {
      event.preventDefault();
      event.returnValue = true;
    }
  }, []);
  useEffect(
    () => () => window.removeEventListener('beforeunload', warnPendingSave),
    [warnPendingSave],
  );

  // Load the current draft once the catalog is known.
  useEffect(() => {
    if (!snapshotId || ready) return;
    let cancelled = false;
    const id = readCurrentId();
    /*
     * The first visit opens an empty canvas, not a prefilled stack: a preselected demo stack would
     * read as a recommendation, and "unknown is not pass" applies to a build nobody has configured.
     * Templates remain an explicit choice on /templates.
     */
    const fresh = () => createDraft(createBuild({ catalogSnapshotId: snapshotId }));
    (id ? builds.get(id) : Promise.reject(new Error('none')))
      .then((stored) => {
        if (cancelled || touched.current) return;
        saveQueue.current = newSaveQueue(stored.build.revision);
        draftRef.current = stored;
        setDraft(stored);
      })
      .catch(() => {
        if (cancelled || touched.current) return;
        saveQueue.current = newSaveQueue(null);
        const next = fresh();
        draftRef.current = next;
        setDraft(next);
        if (id) {
          setSaveState({
            status: 'error',
            message:
              'The saved build could not be loaded. A new blank draft is open; stored data was not changed.',
          });
        }
      })
      .finally(() => !cancelled && setReady(true));
    return () => {
      cancelled = true;
    };
  }, [builds, snapshotId, ready]);

  const reportSaved = useCallback((queue: SaveQueue, id: string, remembered: boolean) => {
    if (queue !== saveQueue.current || queue.pending.length) return;
    if (remembered) {
      setSaveState({ status: 'saved' });
      return;
    }
    const retry = () => {
      if (queue !== saveQueue.current || queue.pending.length) return;
      report(writeCurrentId(id));
    };
    function report(success: boolean) {
      if (success) setSaveState({ status: 'saved' });
      else
        setSaveState({
          status: 'saved',
          warning:
            'Build saved, but this browser could not remember it as current. You can reopen it from My Builds.',
          retryCurrent: retry,
        });
    }
    report(false);
  }, []);

  const drainQueue = useCallback(
    function drain(queue: SaveQueue) {
      if (queue.running || queue.failed) return;
      queue.running = true;
      if (queue === saveQueue.current) setSaveState({ status: 'saving' });
      void (async () => {
        try {
          let remembered = true;
          let savedId: string | undefined;
          while (queue.pending.length) {
            const next = queue.pending[0]!;
            const accepted = await builds.save(next, queue.revision);
            if (queue.detached) return;
            queue.revision = next.build.revision;
            queue.pending.shift();
            if (queue !== saveQueue.current) continue;
            if (draftRef.current === next) {
              draftRef.current = accepted;
              setDraft(accepted);
            }
            savedId = next.build.id;
            remembered = writeCurrentId(savedId);
          }
          if (queue === saveQueue.current && !queue.pending.length)
            window.removeEventListener('beforeunload', warnPendingSave);
          if (savedId) reportSaved(queue, savedId, remembered);
        } catch (e) {
          if (queue.detached) return;
          queue.failed = true;
          if (queue !== saveQueue.current) return;
          setSaveState({
            status: 'error',
            message: `${isDataError(e) ? e.message : 'Could not save this build.'} Edits remain unsaved until saving succeeds.`,
            retry: () => {
              if (queue !== saveQueue.current || !queue.failed) return;
              queue.failed = false;
              drain(queue);
            },
          });
        } finally {
          queue.running = false;
        }
      })();
    },
    [builds, reportSaved, warnPendingSave],
  );

  const persist = useCallback(
    (next: BuildDraft) => {
      const queue = saveQueue.current;
      queue.pending.push(next);
      window.addEventListener('beforeunload', warnPendingSave);
      drainQueue(queue);
    },
    [drainQueue, warnPendingSave],
  );

  const apply = useCallback<BuilderApi['apply']>(
    (change, summary, changedKinds, guard) => {
      const current = draftRef.current;
      if (!current || (guard && !guard(current.build))) return false;
      draftIntent.current++;
      const next = commit(current, change, summary, changedKinds);
      draftRef.current = next;
      setDraft(next);
      if (
        graph.data &&
        graph.data.id === current.build.locks.dependency_graph_id &&
        graph.data.revision === current.build.locks.dependency_graph_revision &&
        graph.data.id === next.build.locks.dependency_graph_id &&
        graph.data.revision === next.build.locks.dependency_graph_revision
      ) {
        const before = buildContext(
          current.build,
          snapshotId === current.build.locks.catalog_snapshot_id ? catalogById : new Map(),
        );
        const after = buildContext(
          next.build,
          snapshotId === next.build.locks.catalog_snapshot_id ? catalogById : new Map(),
        );
        setLastChange({
          ...affectedByChange(graph.data, changedKinds, before, after),
          revision: next.build.revision,
          summary,
        });
      } else {
        setLastChange(null);
      }
      persist(next);
      return true;
    },
    [catalogById, graph.data, persist, snapshotId],
  );

  const finishStart = useCallback(
    (catalogSnapshotId: string, request: PendingStart) => {
      if (request.intent !== draftIntent.current) return;
      const { template, name } = request;
      const base = createBuild({ catalogSnapshotId, name });
      const build: BuildSnapshot = template
        ? {
            ...template,
            id: base.id,
            revision: 1,
            created_at: base.created_at,
            updated_at: base.updated_at,
            lifecycle: 'draft',
            owner_ref: base.owner_ref,
            name: name ?? template.name,
          }
        : base;
      const next = createDraft(
        build,
        template ? `Created from "${template.name}"` : 'Created build',
      );
      saveQueue.current = newSaveQueue(null);
      setLastChange(null);
      draftRef.current = next;
      setDraft(next);
      setReady(true);
      persist(next);
    },
    [persist],
  );

  useEffect(() => {
    if (
      !snapshotId ||
      !pendingStart ||
      pendingStart.intent !== draftIntent.current ||
      pendingStart.intent === completedPendingStart.current
    )
      return;
    completedPendingStart.current = pendingStart.intent;
    finishStart(snapshotId, pendingStart);
  }, [snapshotId, pendingStart, finishStart]);

  const startNew = useCallback<BuilderApi['startNew']>(
    (template, name, discardConfirmed = false, deleted) => {
      if (deleted) {
        const current = draftRef.current;
        if (!current || current.build.id !== deleted.id) return false;
        if (
          current.build.revision !== deleted.revision ||
          pendingOpen.current === draftIntent.current
        ) {
          const queue = saveQueue.current;
          queue.detached = true;
          queue.failed = true;
          if (current.build.revision !== deleted.revision && !queue.pending.length)
            queue.pending.push(current);
          if (queue.pending.length) window.addEventListener('beforeunload', warnPendingSave);
          setSaveState({
            status: 'error',
            unsaved: true,
            message:
              'This build was removed. It is not in the saved library; use Save a copy before leaving.',
          });
          return false;
        }
      }
      if (
        !discardConfirmed &&
        saveQueue.current.pending.length > 0 &&
        !window.confirm('This build has unsaved changes. Replace it anyway?')
      )
        return false;
      const request = { intent: ++draftIntent.current, template, name };
      // Preserve the latest choice while the shared catalog query loads or is retried.
      touched.current = true;
      if (snapshotId) {
        setPendingStart(null);
        finishStart(snapshotId, request);
      } else {
        setPendingStart(request);
      }
      return true;
    },
    [finishStart, snapshotId, warnPendingSave],
  );

  const open = useCallback<BuilderApi['open']>(
    async (buildId, signal) => {
      if (signal?.aborted) return false;
      const intent = ++draftIntent.current;
      pendingOpen.current = intent;
      let stored: BuildDraft;
      try {
        stored = await builds.get(buildId);
      } catch (error) {
        if (signal?.aborted || intent !== draftIntent.current) return false;
        throw error;
      } finally {
        if (pendingOpen.current === intent) pendingOpen.current = null;
      }
      if (signal?.aborted || intent !== draftIntent.current) return false;
      if (
        saveQueue.current.pending.length > 0 &&
        !window.confirm('This build has unsaved changes. Replace it anyway?')
      )
        return false;
      touched.current = true;
      const queue = newSaveQueue(stored.build.revision);
      saveQueue.current = queue;
      window.removeEventListener('beforeunload', warnPendingSave);
      setLastChange(null);
      draftRef.current = stored;
      setDraft(stored);
      reportSaved(queue, buildId, writeCurrentId(buildId));
      return true;
    },
    [builds, reportSaved, warnPendingSave],
  );

  const restore = useCallback<BuilderApi['restore']>(
    (revision) => {
      if (!draft) return;
      const old = draft.revisions.find((r) => r.revision === revision);
      if (!old) return;
      apply(
        // Restore the historical content while retaining this build's identity and lifecycle.
        (b) => ({
          ...structuredClone(old),
          id: b.id,
          revision: b.revision,
          owner_ref: b.owner_ref,
          lifecycle: b.lifecycle,
          created_at: b.created_at,
          updated_at: b.updated_at,
        }),
        `Restored content of revision ${revision}`,
        [...new Set([...old.selections, ...draft.build.selections].map((s) => s.kind))],
        (current) =>
          current.id === draft.build.id &&
          Boolean(draftRef.current?.revisions.some((snapshot) => snapshot.revision === revision)),
      );
    },
    [apply, draft],
  );

  const value = useMemo<BuilderApi>(
    () => ({ draft, ready, catalogById, lastChange, saveState, apply, startNew, open, restore }),
    [draft, ready, catalogById, lastChange, saveState, apply, startNew, open, restore],
  );
  return <BuilderContext.Provider value={value}>{children}</BuilderContext.Provider>;
}

export function useBuilder(): BuilderApi {
  const ctx = useContext(BuilderContext);
  if (!ctx) throw new Error('BuilderProvider missing');
  return ctx;
}
