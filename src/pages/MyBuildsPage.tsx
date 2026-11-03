import { evaluateBuild } from '../data/evaluation-evidence';
/*
 * My Builds (mock: `#buildsScreen` + `renderBuildsPage()` and the `data-saved-action` handlers).
 *
 * The library uses a browser-local index, while build snapshots may be stored locally or by the
 * configured API. Every destructive action has an inline confirm step, unreadable records are
 * explained rather than hidden, and invalid snapshots cannot be exported as JSON.
 */
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { BuildSnapshot, CostEstimate, EvaluationReport } from '../contracts';
import { kindDef } from '../contracts';
import { createDraft, newBuildId } from '../domain/build';
import { derivedBuildName } from '../domain/build-name';
import { compareScaled, toScaled } from '../domain/decimal';
import { compareNewestRecordedDates } from '../domain/date-time';
import {
  canExport,
  exportBuildJson,
  exportFileImportProblem,
  exportFileName,
  importBuildFile,
} from '../domain/share';
import type { SavedBuildSummary } from '../data/types';
import { estimateBuildCost } from '../data/cost-evidence';
import { isDataError } from '../data/errors';
import { useBuilder } from '../app/builder-context';
import { useData } from '../app/data-context';
import { useBuildAnalysis } from '../app/queries';
import { LAYERS } from '../lib/layers';
import { formatRecordedDate } from '../lib/date-format';
import { ErrorState, Loading, useToast } from '../components/feedback';
import { Icon } from '../components/icon';
import { PageHeader } from '../components/layout';
import { download } from '../features/builder/BuildToolbar';
import { IndexRecovery } from '../features/builds/IndexRecovery';
import { ExportWarning, type ExportWarningData } from '../features/builds/ExportWarning';
import { costShort } from '../features/builder/analysis';

const LIST_KEY = ['builds', 'list'] as const;
const UNREADABLE = '(unreadable saved build)';

type SortKey = 'updated' | 'name' | 'cost';

interface BuildDetail {
  build: BuildSnapshot;
  /**
   * The estimator's result, kept whole: storing only the amount lost the coverage and the period, so
   * an all-unpriced build displayed as $0/mo and a partial total displayed as complete.
   */
  cost?: CostEstimate;
  costFailed?: boolean;
  report?: EvaluationReport;
}

function validationStatus(conflicts: number, unknown: number): string {
  const statuses = [];
  if (conflicts) statuses.push(`${conflicts} conflict${conflicts === 1 ? '' : 's'}`);
  if (unknown) statuses.push(`${unknown} unknown`);
  return statuses.join(' · ') || 'No conflicts';
}

const errorText = (e: unknown, fallback: string) =>
  isDataError(e) || e instanceof Error ? e.message : fallback;

const isUnreadable = (summary: SavedBuildSummary) =>
  summary.name === UNREADABLE && summary.revision === 0;

/** Layers filled = distinct tiers with at least one enabled selection. */
function filledLayers(build: BuildSnapshot): number {
  return new Set(build.selections.filter((s) => s.enabled).map((s) => kindDef(s.kind).tier)).size;
}

export default function MyBuildsPage() {
  const { builds, buildStore, mode, pricing, compatibility } = useData();
  const { draft, open, startNew, saveState } = useBuilder();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: LIST_KEY, queryFn: () => builds.list() });
  const [sort, setSort] = useState<SortKey>('updated');
  const [importError, setImportError] = useState<string | null>(null);
  const [importNotice, setImportNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const importRequest = useRef(0);
  const openRequest = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      importRequest.current++;
      openRequest.current?.abort();
    },
    [],
  );
  const analysis = useBuildAnalysis(draft?.build ?? null);
  const invalidate = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ['builds'] }),
    [queryClient],
  );

  const rebuildIndex = builds.rebuildIndex?.bind(builds);
  const indexRecovery = rebuildIndex ? (
    <IndexRecovery
      rebuild={rebuildIndex}
      onComplete={(count) => {
        void invalidate();
        toast(`Found ${count} stored build record${count === 1 ? '' : 's'}.`);
      }}
    />
  ) : null;

  const summaries = list.data ?? [];
  // Load each stage independently so a slow or failed check does not hide known details.
  const buildResults = useQueries({
    queries: summaries.map((summary) => ({
      queryKey: ['builds', 'detail-build', summary.id, summary.revision, summary.deleteToken],
      enabled: !isUnreadable(summary),
      queryFn: async (): Promise<BuildSnapshot> => {
        const stored = await builds.get(summary.id);
        if (stored.build.id !== summary.id || stored.build.revision !== summary.revision)
          throw new Error('Saved build changed while its details were loading.');
        return stored.build;
      },
    })),
  });
  const costResults = useQueries({
    queries: summaries.map((summary, index) => {
      const buildQuery = buildResults[index];
      const build = buildQuery?.isError ? undefined : buildQuery?.data;
      return {
        queryKey: ['builds', 'detail-cost', summary.id, summary.deleteToken, build ?? null],
        enabled: Boolean(build),
        queryFn: async () => {
          if (!build) throw new Error('Saved build is not available.');
          return estimateBuildCost(pricing, build);
        },
      };
    }),
  });
  const reportResults = useQueries({
    queries: summaries.map((summary, index) => {
      const buildQuery = buildResults[index];
      const build = buildQuery?.isError ? undefined : buildQuery?.data;
      const costQuery = costResults[index];
      const cost = costQuery?.isError ? undefined : costQuery?.data;
      return {
        queryKey: [
          'builds',
          'detail-report',
          summary.id,
          summary.deleteToken,
          build ?? null,
          cost ?? null,
        ],
        enabled: Boolean(build) && Boolean(costQuery && !costQuery.isPending),
        queryFn: async () => {
          if (!build) throw new Error('Saved build is not available.');
          return evaluateBuild(compatibility, build, { costEstimate: cost ?? null });
        },
      };
    }),
  });
  const details = new Map(
    summaries.flatMap((summary, index) => {
      const buildQuery = buildResults[index];
      const build = buildQuery?.isError ? undefined : buildQuery?.data;
      if (!build) return [];
      const costQuery = costResults[index];
      const reportQuery = reportResults[index];
      const detail: BuildDetail = {
        build,
        cost: costQuery?.isError ? undefined : costQuery?.data,
        costFailed: costQuery?.isError,
        report: costQuery?.isPending || reportQuery?.isError ? undefined : reportQuery?.data,
      };
      return [[summary.id, detail] as const];
    }),
  );

  // The draft is persisted asynchronously; refresh the library whenever the current build changes.
  const draftId = draft?.build.id;
  useEffect(() => {
    if (draftId) void invalidate();
  }, [draftId, invalidate]);

  // A list request can finish before persistence; refresh again after a successful save.
  useEffect(() => {
    if (draftId && saveState.status === 'saved') void invalidate();
  }, [draftId, invalidate, saveState]);

  const onImport = async (file: File | undefined) => {
    if (!file) return;
    const request = ++importRequest.current;
    setImportError(null);
    setImportNotice(null);
    const result = await importBuildFile(file, mode);
    if (request !== importRequest.current) return;
    if (!result.ok) {
      setImportError(`Import failed: ${result.error}`);
      return;
    }
    if (startNew(result.build, result.build.name) === false) return;
    if (result.warnings.length) setImportNotice(result.warnings.join(' '));
    void invalidate();
    void navigate('/builder');
  };

  const saveCopy = () => {
    if (!draft) return;
    startNew(draft.build, derivedBuildName(draft.build.name, 'copy'));
  };

  const duplicate = async (summary: SavedBuildSummary) => {
    const stored = await builds.get(summary.id);
    const now = new Date().toISOString();
    const copy: BuildSnapshot = {
      ...stored.build,
      id: newBuildId(),
      name: derivedBuildName(stored.build.name, 'copy'),
      revision: 1,
      lifecycle: 'draft',
      created_at: now,
      updated_at: now,
    };
    await builds.save(createDraft(copy), null);
    await invalidate();
    toast('Build duplicated.');
  };

  const recover = async (summary: SavedBuildSummary) => {
    if (!builds.recoverHead) return;
    const head = await builds.recoverHead(summary.id);
    const now = new Date().toISOString();
    const id = newBuildId();
    if (id === summary.id)
      throw new Error('Could not create a distinct recovery copy. Please retry.');
    try {
      await builds.get(id);
      throw new Error('Could not create a distinct recovery copy. Please retry.');
    } catch (error) {
      if (!isDataError(error) || error.kind !== 'not_found') throw error;
    }
    const copy: BuildSnapshot = {
      ...head,
      id,
      name: derivedBuildName(head.name, 'recovered'),
      revision: 1,
      lifecycle: 'draft',
      created_at: now,
      updated_at: now,
    };
    await builds.save(
      createDraft(copy, 'Recovered current build; prior history was not recovered'),
      null,
    );
    await invalidate();
    toast('Current build recovered as a new copy.');
  };

  const exportOne = async (summary: SavedBuildSummary) => {
    const stored = await builds.get(summary.id);
    const problem = canExport(stored.build);
    if (problem) throw new Error(problem);
    const json = exportBuildJson(stored.build, mode);
    const filename = exportFileName(stored.build);
    download(filename, json);
    const importProblem = exportFileImportProblem(json);
    if (importProblem) return { filename, problem: importProblem };
    toast('Saved build exported.');
    return null;
  };

  const removeOne = async (summary: SavedBuildSummary) => {
    const revision = summary.id === draft?.build.id ? draft.build.revision : null;
    try {
      await builds.remove(summary.id, summary.deleteToken);
    } catch (error) {
      if (isDataError(error) && error.kind === 'conflict') void invalidate();
      throw error;
    }
    startNew(undefined, undefined, true, { id: summary.id, revision });
    await invalidate();
    toast(
      buildStore === 'http'
        ? 'Removed from this browser. The API copy was not deleted.'
        : 'Saved build deleted.',
    );
  };

  const sorted = [...summaries].sort((a, b) => {
    if (sort === 'name') return a.name.localeCompare(b.name);
    if (sort === 'cost') {
      const ca = details.get(a.id)?.cost;
      const cb = details.get(b.id)?.cost;
      if (!ca && !cb) return compareNewestRecordedDates(a.updatedAt, b.updatedAt);
      if (!ca) return 1;
      if (!cb) return -1;
      // Rank by coverage first: a lower bound is not "cheaper" than a complete total.
      const rank = (cost: CostEstimate) =>
        cost.coverage === 'complete' ? 0 : cost.coverage === 'partial' ? 1 : 2;
      const byCoverage = rank(ca) - rank(cb);
      if (byCoverage) return byCoverage;
      if (ca.coverage === 'unknown') return compareNewestRecordedDates(a.updatedAt, b.updatedAt);
      // Amounts are comparable only within the same currency and estimate period.
      const group = ca.currency.localeCompare(cb.currency) || ca.period_days - cb.period_days;
      if (group) return group;
      const amountA = toScaled(ca.total.amount);
      const amountB = toScaled(cb.total.amount);
      if (amountA === null || amountB === null)
        return compareNewestRecordedDates(a.updatedAt, b.updatedAt);
      return (
        compareScaled(amountA, amountB) || compareNewestRecordedDates(a.updatedAt, b.updatedAt)
      );
    }
    return compareNewestRecordedDates(a.updatedAt, b.updatedAt);
  });

  const workingTotal = analysis.costIsCurrent ? analysis.cost : undefined;
  const workingCost = costShort(workingTotal);
  const workingSummary = analysis.reportIsCurrent ? analysis.report?.summary : undefined;
  const workingLayers = draft ? filledLayers(draft.build) : 0;

  return (
    <div className="app-page">
      <PageHeader
        compact
        breadcrumb="WORKSPACE"
        eyebrow="YOUR WORKSPACE"
        title={
          <>
            Good builds are
            <br />
            <span>worth keeping.</span>
          </>
        }
        aside={
          <div className="builds-header-actions">
            <button
              className="btn btn-outline"
              type="button"
              onClick={() => fileRef.current?.click()}
            >
              ↥ Import JSON
            </button>
            <button
              className="btn btn-primary"
              type="button"
              onClick={() => {
                if (startNew() === false) return;
                void navigate('/builder');
                toast('New blank build created.');
              }}
            >
              <Icon name="plus" /> New configuration
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              hidden
              aria-hidden="true"
              tabIndex={-1}
              onChange={(e) => {
                void onImport(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </div>
        }
      >
        Explore iterations, duplicate your ideas, or pick up right where you left off.{' '}
        {buildStore === 'local'
          ? 'Builds are stored in this browser.'
          : 'Builds are saved through the configured API.'}
      </PageHeader>

      <div className="container saved-layout">
        <div className="local-note">
          <Icon name="info" />
          <span>
            {buildStore === 'local' ? (
              <>
                <strong>Local workspace.</strong> Your saved configurations live in this
                browser&apos;s storage. They are not synchronized or backed up. Export JSON to keep
                a portable copy.
              </>
            ) : (
              <>
                <strong>API-backed workspace.</strong> Build snapshots are saved through the
                configured API. This browser keeps a local cache and library index. Removing a build
                here does not delete its API copy.
              </>
            )}
            {mode === 'http' && buildStore === 'local'
              ? ' The configured API receives build identifiers and revisions for analysis requests.'
              : ''}
          </span>
        </div>

        {importError ? (
          <p className="notice-error" role="alert">
            {importError}
          </p>
        ) : null}
        {importNotice ? (
          <p className="notice-ok" role="status">
            {importNotice}
          </p>
        ) : null}

        <div className="saved-section-heading">
          <div>
            <span className="eyebrow">CONTINUE WHERE YOU LEFT OFF</span>
            <h2>Currently editing</h2>
          </div>
          <span className="workspace-count">{draft ? '01' : '00'} ACTIVE BUILD</span>
        </div>

        {!draft ? (
          <Loading label="Loading your working build…" />
        ) : (
          <div className="working-card">
            <div className="working-symbol">
              <Icon name="layers" />
            </div>
            <div className="working-content">
              <h3>{draft.build.name}</h3>
              <p>
                Your current, editable configuration · {workingLayers} of {LAYERS.length} layers
                selected
              </p>
              <div className="build-meta-row">
                <span
                  title={
                    analysis.costQuery.isError ? 'Cost estimate unavailable.' : workingCost.note
                  }
                >
                  {analysis.costQuery.isError ? 'Unavailable' : workingCost.text}
                  {!analysis.costQuery.isError && workingCost.qualifier
                    ? ` ${workingCost.qualifier}`
                    : ''}
                </span>
                <span>
                  {workingSummary
                    ? validationStatus(workingSummary.failed, workingSummary.unknown)
                    : 'Not checked'}
                </span>
                <span>IN PROGRESS</span>
              </div>
            </div>
            <div className="working-actions">
              <button
                className="btn btn-outline btn-small"
                type="button"
                onClick={saveCopy}
                disabled={!list.isSuccess || saveState.status === 'saving'}
              >
                Save a copy
              </button>
              <button
                className="btn btn-primary btn-small"
                type="button"
                onClick={() => void navigate('/builder')}
              >
                Continue editing →
              </button>
            </div>
          </div>
        )}

        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className={
            saveState.status === 'error' || (saveState.status === 'saved' && saveState.warning)
              ? 'notice-error'
              : undefined
          }
        >
          {saveState.status === 'error'
            ? `Not saved: ${saveState.message}`
            : saveState.status === 'saving'
              ? 'Saving…'
              : saveState.status === 'saved'
                ? (saveState.warning ?? 'Saved.')
                : ''}
        </div>
        {saveState.status === 'saved' && saveState.retryCurrent ? (
          <button
            className="btn btn-outline btn-small"
            type="button"
            onClick={saveState.retryCurrent}
          >
            Retry remembering current build
          </button>
        ) : null}

        <div className="saved-section-heading lower">
          <div>
            <span className="eyebrow">SAVED CONFIGURATIONS</span>
            <h2>
              Your library{' '}
              {list.isSuccess ? <span className="count-light">({summaries.length})</span> : null}
            </h2>
          </div>
          <div className="saved-sort">
            <label htmlFor="savedSort">SORT BY</label>
            <select
              className="form-select"
              id="savedSort"
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
            >
              <option value="updated">Recently edited</option>
              <option value="name">Name A–Z</option>
              <option value="cost">Example cost</option>
            </select>
          </div>
        </div>

        {sort === 'cost' ? (
          <p className="hint-text saved-cost-sort-note">
            Estimates are grouped by coverage, currency and period. Amounts are ordered only within
            each group; partial estimates are lower bounds.
          </p>
        ) : null}

        <div className="saved-grid">
          {list.isError ? (
            <div>
              <ErrorState
                title="Could not load saved builds"
                error={list.error}
                onRetry={() => void list.refetch()}
              />
              {isDataError(list.error) && list.error.kind === 'malformed' ? indexRecovery : null}
            </div>
          ) : !list.data ? (
            <Loading label="Loading saved builds…" />
          ) : sorted.length === 0 ? (
            <div className="saved-empty">
              <Icon name="layers" />
              <h3>No saved configurations yet</h3>
              <p>
                Your current stack is ready to save. Give it a name in the builder, then hit Save.
              </p>
              <button className="btn btn-primary" type="button" onClick={saveCopy}>
                Save your current build →
              </button>
              {indexRecovery}
            </div>
          ) : (
            sorted.map((summary) => (
              <SavedCard
                key={summary.id}
                summary={summary}
                detail={details.get(summary.id)}
                dataMode={mode}
                buildStore={buildStore}
                showCostGroup={sort === 'cost'}
                current={summary.id === draft?.build.id}
                unsaved={
                  saveState.status === 'saving' ||
                  (saveState.status === 'error' && Boolean(saveState.retry || saveState.unsaved))
                }
                onOpen={async () => {
                  openRequest.current?.abort();
                  const request = new AbortController();
                  openRequest.current = request;
                  if ((await open(summary.id, request.signal)) === false || request.signal.aborted)
                    return;
                  void navigate('/builder');
                }}
                onDuplicate={() => duplicate(summary)}
                onExport={() => exportOne(summary)}
                onRecover={builds.recoverHead ? () => recover(summary) : undefined}
                onDelete={(confirmed) => removeOne(confirmed)}
              />
            ))
          )}
        </div>

        {list.isSuccess && sorted.length > 0 && indexRecovery ? (
          <details className="saved-index-recovery">
            <summary>Missing a saved build?</summary>
            {indexRecovery}
          </details>
        ) : null}

        <div className="saved-bottom">
          <span>
            {mode === 'fixture'
              ? 'Looking for a starting point? Browse complete, editable configurations.'
              : 'Looking for a starting point? Browse the active catalog.'}
          </span>
          <Link to={mode === 'fixture' ? '/templates' : '/catalog'}>
            {mode === 'fixture' ? 'View starter builds' : 'Browse components'}{' '}
            <Icon name="arrow-right" />
          </Link>
        </div>
      </div>
    </div>
  );
}

function SavedCard({
  summary,
  detail,
  dataMode,
  buildStore,
  showCostGroup,
  current,
  unsaved,
  onOpen,
  onDuplicate,
  onExport,
  onRecover,
  onDelete,
}: {
  summary: SavedBuildSummary;
  detail: BuildDetail | undefined;
  dataMode: 'fixture' | 'http';
  buildStore: 'local' | 'http';
  showCostGroup: boolean;
  current: boolean;
  unsaved: boolean;
  onOpen: () => Promise<void>;
  onDuplicate: () => Promise<void>;
  onExport: () => Promise<ExportWarningData | null>;
  onRecover?: () => Promise<void>;
  onDelete: (confirmed: SavedBuildSummary) => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exportWarning, setExportWarning] = useState<ExportWarningData | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmedSummary, setConfirmedSummary] = useState<SavedBuildSummary | null>(null);
  const deleteRef = useRef<HTMLButtonElement>(null);
  const exportRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const unreadable = isUnreadable(summary);
  const deletionUnreadable = confirmedSummary ? isUnreadable(confirmedSummary) : unreadable;
  const label = deletionUnreadable
    ? 'this unreadable build'
    : `“${confirmedSummary?.name ?? summary.name}”`;
  const removalAction = buildStore === 'http' ? 'Remove' : 'Delete';
  const exportProblem =
    detail && detail.build.selections.length < 2
      ? 'Add at least 2 components before exporting.'
      : null;

  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
  }, [confirming]);

  const run = async (labelText: string, action: () => Promise<void>) => {
    setBusy(labelText);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(errorText(e, `${labelText} failed.`));
    } finally {
      setBusy(null);
    }
  };

  const layers = detail ? filledLayers(detail.build) : null;
  // Coverage-aware: a partial estimate reads as a lower bound, never as the full monthly price.
  const cost = costShort(detail?.cost);

  return (
    <article className="saved-card">
      <div className="saved-card-top">
        <div className="saved-card-brand">
          <Icon name={unreadable ? 'alert' : 'layers'} />
        </div>
        <h3>
          {unreadable ? 'Unreadable saved build' : summary.name}
          {current ? <span className="count-light"> (current)</span> : null}
        </h3>
        {unreadable ? (
          <p>
            The saved record <code>{summary.id}</code> is damaged or no longer matches the build
            contract, so it cannot be opened. It has not been changed or repaired.
            {onRecover
              ? ' You can try to recover the current build as a new copy; its prior history will not be included.'
              : null}
          </p>
        ) : (
          <p>
            Edited {formatRecordedDate(summary.updatedAt, 'date')} ·{' '}
            {layers === null
              ? `${summary.selectionCount} selection${summary.selectionCount === 1 ? '' : 's'}`
              : `${layers} of ${LAYERS.length} layers configured`}
          </p>
        )}
        {!unreadable ? (
          <div className="saved-card-metrics">
            <div>
              <small>ESTIMATED BASELINE*</small>
              <strong title={detail?.costFailed ? 'Cost estimate unavailable.' : cost.note}>
                {detail?.costFailed ? 'Unavailable' : cost.text}
                {!detail?.costFailed && cost.qualifier ? (
                  <span className="pt-sub"> {cost.qualifier}</span>
                ) : null}
              </strong>
            </div>
            <div>
              <small>{dataMode === 'fixture' ? 'DEMO VALIDATION' : 'VALIDATION'}</small>
              <strong>
                {detail?.report
                  ? validationStatus(detail.report.summary.failed, detail.report.summary.unknown)
                  : 'Not checked'}
              </strong>
            </div>
          </div>
        ) : null}
        {showCostGroup && detail?.cost && detail.cost.coverage !== 'unknown' ? (
          <p className="hint-text">
            {detail.cost.coverage === 'complete' ? 'Complete' : 'Partial'} · {detail.cost.currency}{' '}
            · {detail.cost.period_days} days
          </p>
        ) : null}
      </div>

      <div className="saved-card-actions">
        {!unreadable ? (
          <>
            <button
              className="open"
              type="button"
              disabled={Boolean(busy)}
              onClick={() => void run('Open', onOpen)}
            >
              Open build →
            </button>
            <button
              type="button"
              aria-label={`Duplicate ${summary.name}`}
              title="Duplicate"
              disabled={Boolean(busy)}
              onClick={() => void run('Duplicate', onDuplicate)}
            >
              <Icon name="copy" />
            </button>
            <button
              ref={exportRef}
              type="button"
              aria-label={`Export JSON of ${summary.name}`}
              title={exportProblem ?? 'Export JSON'}
              disabled={Boolean(busy) || Boolean(exportProblem)}
              onClick={() =>
                void run('Export', async () => {
                  const warning = await onExport();
                  if (warning) setExportWarning(warning);
                })
              }
            >
              <Icon name="download" />
            </button>
          </>
        ) : null}
        {unreadable && onRecover ? (
          <button
            type="button"
            className="open"
            disabled={Boolean(busy)}
            onClick={() => void run('Recover', onRecover)}
          >
            Recover current build as copy
          </button>
        ) : null}
        <button
          ref={deleteRef}
          type="button"
          aria-label={`${removalAction} ${unreadable ? 'unreadable saved build' : summary.name}${buildStore === 'http' ? ' from library' : ''}`}
          title={buildStore === 'http' ? 'Remove from library' : 'Delete'}
          disabled={Boolean(busy)}
          onClick={() => {
            setConfirmedSummary(summary);
            setConfirming(true);
          }}
        >
          <Icon name="x" />
        </button>
      </div>

      {exportProblem ? <p className="hint-text">JSON export: {exportProblem}</p> : null}

      {exportWarning ? (
        <ExportWarning
          warning={exportWarning}
          onDismiss={() => {
            setExportWarning(null);
            requestAnimationFrame(() => exportRef.current?.focus());
          }}
        />
      ) : null}

      {confirming ? (
        <div
          className="notice-error"
          role="group"
          aria-label={buildStore === 'http' ? 'Confirm removal' : 'Confirm delete'}
        >
          <p>
            {buildStore === 'http' ? (
              <>Remove {label} from this browser&apos;s library? The API copy is not deleted.</>
            ) : (
              <>Delete {label} from this browser? This cannot be undone.</>
            )}
            {current ? ' A new empty build will become your current draft.' : ''}
            {current && unsaved ? ' Your unsaved changes will be lost.' : ''}
            {deletionUnreadable
              ? buildStore === 'http'
                ? ' The local record cannot be recovered after removal.'
                : ' The original record cannot be recovered after deletion.'
              : ' Export it first if you need a backup.'}
          </p>
          <p>
            <button
              className="btn btn-outline btn-small"
              type="button"
              disabled={busy === removalAction}
              onClick={() =>
                void run(removalAction, () => onDelete(confirmedSummary!)).then(() => {
                  setConfirming(false);
                })
              }
            >
              {buildStore === 'http' ? 'Yes, remove' : 'Yes, delete'}
            </button>{' '}
            <button
              ref={cancelRef}
              className="btn btn-outline btn-small"
              type="button"
              disabled={busy === removalAction}
              onClick={() => {
                setConfirming(false);
                requestAnimationFrame(() => deleteRef.current?.focus());
              }}
            >
              Cancel
            </button>
          </p>
        </div>
      ) : null}

      {busy ? (
        <p className="hint-text" role="status">
          {busy}…
        </p>
      ) : null}
      {error ? (
        <p className="notice-error" role="alert">
          {error}
        </p>
      ) : null}
    </article>
  );
}
