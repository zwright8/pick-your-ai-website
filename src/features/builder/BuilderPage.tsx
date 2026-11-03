/*
 * System builder.
 *
 * Follows the PCPartPicker builder pattern in docs/research/pcpartpicker-ux-notes.md §3: a fixed,
 * ordered row per component slot with a "Choose …" empty state, a toolbar above the table, a status
 * strip carrying the worst outcome plus live estimates, a running total under the table, lettered
 * findings with a severity word, and an explicit "what was not checked" note.
 *
 * Rows are contract component *kinds* grouped by tier, because a tier holds several decisions
 * (T1 has a model and its provider). Only required kinds get an empty row; optional kinds are
 * reachable from their group header, so the table stays as short as the build actually is.
 */
import '../../styles/dense.css';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useBlocker, useNavigate } from 'react-router';
import type { BuildSnapshot, CatalogItem, ComponentKind, Selection, Tier } from '../../contracts';
import { KIND_LABELS, kindDef, kindsInTier } from '../../contracts';
import type { BuildContext } from '../../domain/activation';
import { KIND_NEED_LABEL, buildContext, coverage, kindNeed } from '../../domain/activation';
import {
  removeSelection,
  rename,
  setEnabled,
  updateObjectives,
  updateSettings,
} from '../../domain/build';
import { MAX_BUILD_NAME_CODEPOINTS } from '../../domain/build-name';
import {
  canExport,
  encodeShareFragment,
  exportBuildJson,
  exportFileImportProblem,
  exportFileName,
} from '../../domain/share';
import { useBuilder } from '../../app/builder-context';
import { useData } from '../../app/data-context';
import { useBuildAnalysis, useCatalog, usePricebook, useRuleset } from '../../app/queries';
import { ErrorState, Loading, Modal, useToast } from '../../components/feedback';
import { Icon } from '../../components/icon';
import { SyntheticBadge } from '../../components/status';
import {
  CostTotals,
  Findings,
  Money,
  NotEvaluated,
  PartsHead,
  StatusStrip,
} from '../../components/parts';
import { flaggedFindings, costHeadline } from './analysis';
import { evidenceLine } from './evidence';
import { incompleteBuild } from './incomplete';
import { itemPrice } from '../../lib/item-cost';
import { kindPath, rowSubtitle } from '../../lib/catalog-view';
import { settingsFields } from '../../lib/schema-fields';
import { formatRecordedDate } from '../../lib/date-format';
import { LAYERS, itemLogo, layerOf } from '../../lib/layers';
import { download } from './BuildToolbar';
import { ObjectivesForm } from './ObjectivesForm';
import { SettingsForm } from './SettingsForm';
import { BuilderLoading, builderDescription } from './BuilderLoading';
import { ExportWarning, type ExportWarningData } from '../builds/ExportWarning';
import { ExportFailure, type ExportFailureData } from '../builds/ExportFailure';

function GroupRow({
  tier,
  ctx,
  build,
  requirementsKnown,
  onAdd,
}: {
  tier: Tier;
  ctx: BuildContext;
  build: BuildSnapshot;
  requirementsKnown: boolean;
  onAdd: () => void;
}) {
  const layer = layerOf(tier);
  const kinds = kindsInTier(tier).map((k) => k.kind);
  const required = kinds.filter((k) => kindNeed(k, ctx.mode) === 'needed');
  const done = required.filter((k) =>
    build.selections.some((s) => s.enabled && s.kind === k),
  ).length;
  const modeDependent = kinds.some((k) => kindNeed(k, ctx.mode) === 'depends_on_mode');
  const optional = kinds.filter((k) => kindNeed(k, ctx.mode) === 'optional');
  const optionalDone = optional.filter((k) =>
    build.selections.some((s) => s.enabled && s.kind === k),
  ).length;
  const status = !requirementsKnown
    ? 'Requirements not evaluated'
    : modeDependent
      ? 'Depends on deployment mode'
      : required.length
        ? `Required ${done}/${required.length}`
        : optional.length
          ? `Optional ${optionalDone}/${optional.length}`
          : KIND_NEED_LABEL.not_needed;
  const anySelected = kinds.some((k) => build.selections.some((s) => s.enabled && s.kind === k));
  return (
    <tr className="pt-group">
      <th colSpan={6} scope="colgroup">
        <div className="pt-group-inner">
          <span className={anySelected ? 'pt-tier on' : 'pt-tier'}>{tier}</span>
          <strong>{layer.name}</strong>
          <span className="grow" />
          <span className="pt-skip">{status}</span>
          <button type="button" className="pbtn" onClick={onAdd}>
            <Icon name="plus" /> Add component
          </button>
        </div>
      </th>
    </tr>
  );
}

function ComponentRow({
  dataMode,
  kind,
  selectionId,
  catalogId,
  pinnedVersion,
  item,
  price,
  enabled,
  addAnother,
  onConfigure,
  onToggleEnabled,
  onRemove,
}: {
  dataMode: 'fixture' | 'http';
  kind: ComponentKind;
  selectionId: string;
  catalogId: string;
  pinnedVersion: string;
  item: CatalogItem | undefined;
  price: ReturnType<typeof itemPrice> | undefined;
  /** A disabled selection is still part of the saved build: it must stay visible and manageable. */
  enabled: boolean;
  /** True on the last row of a `cardinality: many` kind, which may take another selection. */
  addAnother: boolean;
  onConfigure: () => void;
  onToggleEnabled: () => void;
  onRemove: () => void;
}) {
  const versionMismatch = Boolean(item && item.version !== pinnedVersion);
  const evidence = item && !versionMismatch ? evidenceLine(item) : undefined;
  const logo = item ? itemLogo(item) : undefined;
  const name = item?.name ?? KIND_LABELS[kind];
  return (
    <tr data-kind={kind} className={enabled ? undefined : 'is-disabled'}>
      <th scope="row" data-label="Component">
        <span className="pt-name">
          <span className="dim" style={{ fontSize: 11 }}>
            {KIND_LABELS[kind]}
          </span>
        </span>
      </th>
      <td data-label="Selection">
        <div className="pt-name">
          {logo ? (
            <span className={`component-logo ${logo.color}`} aria-hidden="true">
              {logo.text}
            </span>
          ) : null}
          {item ? (
            <span>
              <Link to={`${kindPath(kind)}/${item.id.replace(/\./g, '~')}`}>{item.name}</Link>
              {dataMode === 'http' && item.tags?.includes('synthetic') ? (
                versionMismatch ? (
                  <span className="pt-sub">Current catalog record is synthetic.</span>
                ) : (
                  <SyntheticBadge />
                )
              ) : null}
              {versionMismatch ? (
                <span className="pt-sub">
                  Selected version: {pinnedVersion}. Current catalog version: {item.version}; the
                  linked record may differ.
                </span>
              ) : rowSubtitle(item) ? (
                <span className="pt-sub">{rowSubtitle(item)}</span>
              ) : null}
              {enabled ? null : (
                <span className="pchip pchip-unknown">Disabled — excluded from checks</span>
              )}
              {addAnother ? (
                <Link className="pt-sub" to={`${kindPath(kind)}?add=1`}>
                  <Icon name="plus" /> Add another {KIND_LABELS[kind].toLowerCase()}
                </Link>
              ) : null}
            </span>
          ) : (
            <span>
              <span className="dim">{catalogId}</span>{' '}
              <span className="pchip pchip-unknown">Not in this catalog</span>
              <span className="pt-sub">Selected version: {pinnedVersion}</span>
              {addAnother ? (
                <Link className="pt-sub" to={`${kindPath(kind)}?add=1`}>
                  <Icon name="plus" /> Add another {KIND_LABELS[kind].toLowerCase()}
                </Link>
              ) : null}
            </span>
          )}
        </div>
      </td>
      <td data-label="Cost basis">
        {versionMismatch ? (
          <span className="dim">Not available for selected version</span>
        ) : item ? (
          <span className={item.billing_class === 'unknown' ? 'pchip pchip-unknown' : 'pchip'}>
            {item.billing_class}
          </span>
        ) : (
          <span className="dim">—</span>
        )}
      </td>
      <td data-label="Evidence">
        {versionMismatch ? (
          <span className="dim">Not available for selected version</span>
        ) : evidence ? (
          <span className="pchip" title={evidence.detail}>
            {evidence.label}
          </span>
        ) : (
          <span className="dim">—</span>
        )}
      </td>
      <td className="num" data-label="Est. cost">
        <CostCell price={price} excluded={!enabled} />
      </td>
      <td data-label="Actions">
        <div className="pt-actions">
          <Link
            className="pbtn pbtn-icon"
            to={`${kindPath(kind)}?replace=${encodeURIComponent(selectionId)}`}
            aria-label={`Change ${KIND_LABELS[kind]}`}
            title="Choose a different component"
          >
            <Icon name="arrow-right" />
          </Link>
          {settingsFields(kind).length ? (
            <button
              type="button"
              className="pbtn pbtn-icon"
              aria-label={`Configure ${name}`}
              onClick={onConfigure}
            >
              <Icon name="wand" />
            </button>
          ) : null}
          <button
            type="button"
            className="pbtn pbtn-icon"
            aria-label={`${enabled ? 'Disable' : 'Enable'} ${name}`}
            title={
              enabled
                ? 'Keep the component but exclude it from checks and cost'
                : 'Include this component in checks and cost again'
            }
            onClick={onToggleEnabled}
          >
            <Icon name={enabled ? 'x-circle' : 'check'} />
          </button>
          <button
            type="button"
            className="pbtn pbtn-icon"
            aria-label={`Remove ${name} from the stack`}
            onClick={onRemove}
          >
            <Icon name="x" />
          </button>
        </div>
      </td>
    </tr>
  );
}

/**
 * Price cell.
 *
 * `Included` is a word, not "$0": a zero would read as a measured charge. An unverified free item
 * that the build policy does not admit is `Unknown`, not `Included`. A component whose meters were
 * only partly priced is marked as a lower bound so a partial charge is never read as the full
 * monthly price.
 */
function CostCell({
  price,
  excluded,
}: {
  price: ReturnType<typeof itemPrice> | undefined;
  excluded: boolean;
}) {
  if (excluded)
    return (
      <span className="dim" title="Disabled selections are excluded from the estimate">
        Excluded
      </span>
    );
  if (!price) return <span className="dim">—</span>;
  if (price.amount === null)
    return (
      <span className="pchip pchip-unknown" title={price.note}>
        Unknown
      </span>
    );
  if (price.included)
    return (
      <span className={price.label.endsWith('*') ? 'pchip' : 'dim'} title={price.note}>
        {price.label}
      </span>
    );
  if (price.partial)
    return (
      <span className="pchip pchip-unknown" title={price.note}>
        <Money amount={price.amount} currency={price.currency} approximate /> partial
      </span>
    );
  return <Money amount={price.amount} currency={price.currency} />;
}

function EmptyRow({ kind, onChoose }: { kind: ComponentKind; onChoose: () => void }) {
  return (
    <tr data-kind={kind}>
      <th scope="row" data-label="Component">
        <span className="dim" style={{ fontSize: 11 }}>
          {KIND_LABELS[kind]}
        </span>
      </th>
      <td colSpan={4} data-label="Selection">
        <button type="button" className="pt-choose" onClick={onChoose}>
          <Icon name="plus" /> Choose {KIND_LABELS[kind].toLowerCase()}
        </button>
      </td>
      <td data-label="Actions">
        <span className="pt-skip">Required</span>
      </td>
    </tr>
  );
}

interface ConfigureSession {
  buildId: string;
  selection: Selection;
}

function currentConfiguredSelection(
  build: BuildSnapshot,
  session: ConfigureSession,
): Selection | undefined {
  if (build.id !== session.buildId) return undefined;
  const matches = build.selections.filter((selection) => selection.id === session.selection.id);
  if (matches.length !== 1) return undefined;
  const current = matches[0];
  return current &&
    current.kind === session.selection.kind &&
    current.catalog_item_id === session.selection.catalog_item_id &&
    current.catalog_item_version === session.selection.catalog_item_version
    ? current
    : undefined;
}

export default function BuilderPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { draft, ready, apply, startNew, restore, saveState, lastChange } = useBuilder();
  const { mode } = useData();
  const catalog = useCatalog();
  const pricebook = usePricebook(draft?.build.locks.pricebook_id);
  const ruleset = useRuleset();
  const build = draft?.build;
  const analysis = useBuildAnalysis(build);

  const [name, setName] = useState<string | null>(null);
  const nameComposing = useRef(false);
  const [configure, setConfigure] = useState<ConfigureSession | null>(null);
  const [configureError, setConfigureError] = useState(false);
  const [jsonOpen, setJsonOpen] = useState(false);
  const [exportWarning, setExportWarning] = useState<ExportWarningData | null>(null);
  const [exportFailure, setExportFailure] = useState<ExportFailureData | null>(null);
  const exportRef = useRef<HTMLButtonElement>(null);
  const exportAttempt = useRef(0);
  const [shareError, setShareError] = useState<{ message: string; attempt: number } | null>(null);
  const [shareBuildId, setShareBuildId] = useState(build?.id);
  const shareRef = useRef<HTMLButtonElement>(null);
  const shareWarningRef = useRef<HTMLDivElement>(null);
  const shareAttempt = useRef(0);
  const [objectivesMounted, setObjectivesMounted] = useState(false);
  const [objectivesDirty, setObjectivesDirty] = useState(false);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const nameTooLong = Array.from((name ?? '').trim()).length > MAX_BUILD_NAME_CODEPOINTS;
  if (shareBuildId !== build?.id) {
    setShareBuildId(build?.id);
    setShareError(null);
    setExportFailure(null);
  }
  useLayoutEffect(() => {
    shareAttempt.current++;
  }, [build?.id]);
  useEffect(() => {
    if (shareError) shareWarningRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [shareError]);
  const unappliedChanges = nameTooLong || objectivesDirty || settingsDirty;
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      unappliedChanges && currentLocation.pathname !== nextLocation.pathname,
  );
  const handledBlock = useRef(false);
  useEffect(() => {
    if (blocker.state !== 'blocked') {
      handledBlock.current = false;
      return;
    }
    if (handledBlock.current) return;
    handledBlock.current = true;
    if (window.confirm('You have unapplied changes. Leave without applying them?')) {
      blocker.proceed();
    } else {
      blocker.reset();
    }
  }, [blocker]);
  useEffect(() => {
    if (!unappliedChanges) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = true;
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unappliedChanges]);

  const byId = catalog.byId;
  const ctx = useMemo(
    () =>
      build
        ? buildContext(
            build,
            catalog.data?.id === build.locks.catalog_snapshot_id ? byId : new Map(),
          )
        : undefined,
    [build, byId, catalog.data?.id],
  );
  const cov = useMemo(() => (build && ctx ? coverage(build, ctx) : undefined), [build, ctx]);

  const jsonPreview = useMemo(() => {
    if (!jsonOpen || !build) return null;
    try {
      const text = exportBuildJson(build, mode);
      return { ok: true, text, problem: exportFileImportProblem(text) } as const;
    } catch (e) {
      return {
        ok: false,
        message: e instanceof Error ? e.message : 'Could not prepare JSON.',
      } as const;
    }
  }, [jsonOpen, build, mode]);

  if (catalog.isError)
    return (
      <div className="app-page parts-page">
        <div className="container">
          <ErrorState error={catalog.error} onRetry={() => void catalog.refetch()} />
        </div>
      </div>
    );
  if (!ready || !build || !catalog.data || !ctx || !cov) return <BuilderLoading />;

  const report = analysis.reportIsCurrent ? analysis.report : undefined;
  const requirementsKnown =
    catalog.data.id === build.locks.catalog_snapshot_id &&
    ruleset.data?.id === build.locks.ruleset_id &&
    ruleset.data.version === build.locks.ruleset_version;
  const failed = report?.summary.failed ?? 0;
  const unknown = report?.summary.unknown ?? 0;
  const flagged = flaggedFindings(report);
  const total = analysis.costIsCurrent ? analysis.cost : undefined;
  const headline = costHeadline(total);
  const selectedCount = build.selections.filter((s) => s.enabled).length;
  const requiredDone = cov.needed.length - cov.missing.length;
  /*
   * A build that is merely missing a required pick is *incomplete*, not incompatible: the frozen
   * presence rule legitimately fails its existence assertion, so the raw finding is preserved and
   * the incompleteness is a presentation distinction (#294).
   */
  const incomplete = incompleteBuild(build, report, ruleset.data);
  const outcome: 'pass' | 'fail' | 'unknown' | 'none' = incomplete
    ? 'unknown'
    : failed
      ? 'fail'
      : unknown
        ? 'unknown'
        : report
          ? requirementsKnown && cov.missing.length
            ? 'unknown'
            : 'pass'
          : 'none';
  const announcement = report
    ? `Revision ${report.build_revision} evaluated: ${failed} failing, ${unknown} unknown.`
    : '';
  const affected =
    lastChange && lastChange.revision === build.revision
      ? [...new Set([...lastChange.affectedKinds, ...lastChange.changedKinds])]
      : [];

  const commitName = (value: string) => {
    const next = value.trim();
    if (Array.from(next).length > MAX_BUILD_NAME_CODEPOINTS) return;
    setName(null);
    if (next && next !== build.name)
      apply((b) => rename(b, next), `Renamed build to "${next}"`, []);
  };

  const remove = (selectionId: string, kind: ComponentKind, itemName: string) => {
    apply((b) => removeSelection(b, selectionId), `Removed ${KIND_LABELS[kind]}: ${itemName}`, [
      kind,
    ]);
    toast(`${itemName} removed from your stack.`);
  };

  const exportJson = () => {
    const attempt = ++exportAttempt.current;
    try {
      const problem = canExport(build);
      if (problem) {
        setExportFailure({ message: problem, attempt });
        return;
      }
      const json = exportBuildJson(build, mode);
      const filename = exportFileName(build);
      const importProblem = exportFileImportProblem(json);
      download(filename, json);
      setExportFailure(null);
      if (importProblem) setExportWarning({ filename, problem: importProblem });
      else toast('Configuration exported as JSON.');
    } catch {
      setExportFailure({ message: 'Please try again.', attempt });
    }
  };

  const share = async () => {
    const attempt = ++shareAttempt.current;
    // Encoding a draft the contract rejects throws, so validate first and say why.
    const problem = canExport(build);
    if (problem) {
      setShareError({ message: problem, attempt });
      return;
    }
    let url: string;
    try {
      url = `${location.origin}/shared#${encodeShareFragment(build, mode)}`;
    } catch (e) {
      setShareError({
        message: e instanceof Error ? e.message : 'This build cannot be encoded into a link.',
        attempt,
      });
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      if (attempt !== shareAttempt.current) return;
      setShareError(null);
      toast('Share link copied. The build travels in the link itself (after #).');
    } catch {
      if (attempt !== shareAttempt.current) return;
      setShareError({ message: 'Could not copy the link. Use Export instead.', attempt });
    }
  };

  const currentSelection = configure ? currentConfiguredSelection(build, configure) : undefined;
  const configureSelection = configure ? (currentSelection ?? configure.selection) : undefined;
  const configureChanged = Boolean(configure && (!currentSelection || configureError));
  const configureCandidate = configureSelection
    ? byId.get(configureSelection.catalog_item_id)
    : undefined;
  const configureItem =
    configureCandidate?.kind === configureSelection?.kind ? configureCandidate : undefined;
  const closeSettings = () => {
    if (settingsDirty && !window.confirm('Discard unapplied component settings?')) return;
    setSettingsDirty(false);
    setConfigureError(false);
    setConfigure(null);
  };

  /**
   * Rows for one tier: every selected component — enabled *or* disabled, because a disabled
   * selection is still part of the saved build and its configure, enable and remove controls must
   * stay reachable — plus an empty row for each required gap.
   */
  const rowsFor = (tier: Tier) => {
    const kinds = kindsInTier(tier).map((k) => k.kind);
    const rows: React.ReactNode[] = [];
    for (const kind of kinds) {
      const selections = build.selections.filter((s) => s.kind === kind);
      if (selections.length === 0) {
        if (requirementsKnown && kindNeed(kind, ctx.mode) === 'needed')
          rows.push(
            <EmptyRow key={kind} kind={kind} onChoose={() => void navigate(kindPath(kind))} />,
          );
        continue;
      }
      const many = kindDef(kind).cardinality === 'many';
      selections.forEach((selection, index) => {
        const candidate = byId.get(selection.catalog_item_id);
        const item = candidate?.kind === selection.kind ? candidate : undefined;
        const name = item?.name ?? selection.catalog_item_id;
        rows.push(
          <ComponentRow
            dataMode={mode}
            key={selection.id}
            kind={kind}
            selectionId={selection.id}
            catalogId={selection.catalog_item_id}
            pinnedVersion={selection.catalog_item_version}
            item={item}
            price={
              item && selection.enabled
                ? itemPrice(item, build, byId, pricebook.data, catalog.data?.id, selection)
                : undefined
            }
            enabled={selection.enabled}
            addAnother={many && index === selections.length - 1}
            onConfigure={() => {
              setConfigureError(false);
              setConfigure({ buildId: build.id, selection });
            }}
            onToggleEnabled={() => {
              const next = !selection.enabled;
              apply(
                (b) => setEnabled(b, selection.id, next),
                `${next ? 'Enabled' : 'Disabled'} ${KIND_LABELS[kind]}: ${name}`,
                [kind],
              );
              toast(
                next
                  ? `${name} is included in checks again.`
                  : `${name} is kept but excluded from checks and cost.`,
              );
            }}
            onRemove={() => remove(selection.id, kind, name)}
          />,
        );
      });
    }
    return rows;
  };

  return (
    <div className="app-page parts-page">
      <div className="container">
        <PartsHead
          crumbs={
            <>
              <Link to="/">PickYour.AI</Link> <span>/</span> Builder
            </>
          }
          title="Choose your parts"
          description={builderDescription(mode)}
          actions={
            <>
              <button type="button" className="pbtn" onClick={() => setJsonOpen(true)}>
                <Icon name="code" /> View JSON
              </button>
              <button ref={shareRef} type="button" className="pbtn" onClick={() => void share()}>
                <Icon name="copy" /> Copy share link
              </button>
              <button
                ref={exportRef}
                type="button"
                className="pbtn pbtn-primary"
                onClick={exportJson}
              >
                <Icon name="download" /> Export
              </button>
            </>
          }
        />

        {shareError ? (
          <div ref={shareWarningRef} className="notice-error share-warning">
            <p key={shareError.attempt} role="alert">
              Share link was not copied. {shareError.message}
            </p>
            <button
              type="button"
              className="btn btn-outline btn-small"
              onClick={() => {
                setShareError(null);
                requestAnimationFrame(() => shareRef.current?.focus());
              }}
            >
              Dismiss sharing warning
            </button>
          </div>
        ) : null}

        {exportFailure ? (
          <ExportFailure
            failure={exportFailure}
            onDismiss={() => {
              setExportFailure(null);
              requestAnimationFrame(() => exportRef.current?.focus());
            }}
          />
        ) : null}

        {exportWarning ? (
          <ExportWarning
            warning={exportWarning}
            onDismiss={() => {
              setExportWarning(null);
              requestAnimationFrame(() => exportRef.current?.focus());
            }}
          />
        ) : null}

        {/* Toolbar: name, state, local-first actions (research §3.9). */}
        <div className="pbar">
          <div className="pbar-field">
            <Icon name="layers" />
            <input
              aria-label="Build name"
              className="pbar-input"
              type="text"
              value={name ?? build.name}
              aria-invalid={nameTooLong || undefined}
              aria-describedby={nameTooLong ? 'build-name-error' : undefined}
              onChange={(e) => setName(e.target.value)}
              onCompositionStart={() => {
                nameComposing.current = true;
              }}
              onCompositionEnd={() => {
                nameComposing.current = false;
              }}
              onBlur={(e) => commitName(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !nameComposing.current && !e.nativeEvent.isComposing) {
                  commitName(e.currentTarget.value);
                }
              }}
            />
            <span className="pbar-meta">
              {saveState?.status === 'error' ? 'Not saved' : 'Draft'} · rev {build.revision}
            </span>
          </div>
          <div className="pbar-actions">
            <button
              type="button"
              className="pbtn"
              onClick={() => {
                if (
                  unappliedChanges &&
                  !window.confirm('This build has unsaved or unapplied changes. Replace it anyway?')
                )
                  return;
                if (startNew(undefined, undefined, unappliedChanges) === false) return;
                setName(null);
                setObjectivesDirty(false);
                toast('New blank build created.');
              }}
            >
              <Icon name="plus" /> New
            </button>
            <Link className="pbtn" to="/builds">
              <Icon name="download" /> Save / history
            </Link>
            <Link className="pbtn" to="/summary">
              <Icon name="list" /> Summary
            </Link>
          </div>
        </div>

        {nameTooLong ? (
          <p id="build-name-error" className="field-error" role="alert">
            Build names can have at most {MAX_BUILD_NAME_CODEPOINTS} characters. Shorten the name to
            save it.
          </p>
        ) : null}

        <StatusStrip
          outcome={outcome}
          headline={
            incomplete
              ? `Incomplete — ${incomplete.chosen} of ${incomplete.total} required choices made`
              : failed
                ? `Incompatible — ${failed} compatibility error${failed === 1 ? '' : 's'}`
                : unknown
                  ? `Unknowns — ${unknown} check${unknown === 1 ? '' : 's'} unknown`
                  : requirementsKnown && cov.missing.length
                    ? `${cov.missing.length} required component${cov.missing.length === 1 ? '' : 's'} missing`
                    : report
                      ? 'Compatible (rules pass) — no compatibility errors'
                      : 'Not evaluated yet'
          }
          detail={
            incomplete
              ? `${incomplete.remediation} Provisional inference from presence rules; the contract finding below is unchanged.`
              : failed
                ? 'See the compatibility notes below.'
                : unknown
                  ? 'Unknown is not a pass.'
                  : requirementsKnown && cov.missing.length
                    ? 'The rows marked Required are still empty.'
                    : undefined
          }
          stats={[
            {
              label: 'Required',
              value: requirementsKnown ? `${requiredDone}/${cov.needed.length}` : 'Not evaluated',
              unknown: !requirementsKnown,
            },
            { label: 'Selected', value: String(selectedCount) },
            {
              label: 'Est. monthly',
              value: total ? headline.text.split(' /')[0]! : '—',
              unknown: !total || total.coverage !== 'complete',
            },
            {
              label: 'Unknown checks',
              value: report ? String(unknown) : 'Not evaluated',
              unknown: !report || unknown > 0,
            },
          ]}
        />

        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className={
            saveState?.status === 'error' || (saveState?.status === 'saved' && saveState.warning)
              ? 'pnotice pbox-save-error'
              : undefined
          }
        >
          {saveState?.status === 'error'
            ? `Not saved: ${saveState.message}`
            : saveState?.status === 'saved'
              ? (saveState.warning ?? '')
              : ''}
        </div>
        {saveState?.status === 'error' && saveState.retry ? (
          <button type="button" className="pbtn save-retry" onClick={saveState.retry}>
            Retry saving
          </button>
        ) : null}
        {saveState?.status === 'saved' && saveState.retryCurrent ? (
          <button type="button" className="pbtn save-retry" onClick={saveState.retryCurrent}>
            Retry remembering current build
          </button>
        ) : null}

        <p className="sr-only" aria-live="polite" role="status">
          {announcement}
        </p>

        {!analysis.reportIsCurrent && analysis.report ? (
          <p className="pbox-note" role="status">
            Previous evaluation: revision {analysis.report.build_revision}
            {analysis.report.build_id !== build.id ? ' of another build' : ''}. These results are
            not current, so they are withheld below until this revision is evaluated.
          </p>
        ) : null}

        {affected.length ? (
          <div className="pnotice" style={{ marginTop: 10 }}>
            <Icon name="workflow" />
            <span>
              <strong>{lastChange?.summary}.</strong> Through the dependency graph this re-checks:{' '}
              {affected.map((k) => KIND_LABELS[k]).join(', ')}. Earlier evaluations, estimates and
              quotes for this build are now stale.
            </span>
          </div>
        ) : null}

        {analysis.costQuery.isError ? (
          <div style={{ marginTop: 10 }}>
            <ErrorState
              title="Pricing unavailable"
              error={analysis.costQuery.error}
              onRetry={() => void analysis.costQuery.refetch()}
            />
          </div>
        ) : null}

        {analysis.evaluation.isError ? (
          <div style={{ marginTop: 10 }}>
            <ErrorState
              error={analysis.evaluation.error}
              onRetry={() => void analysis.evaluation.refetch()}
            />
          </div>
        ) : null}

        <div className="pt-wrap">
          <div className="pt-scroll" tabIndex={0} role="region" aria-label="Scrollable parts table">
            <table className="pt">
              <caption>Stack components by layer · T0 to T6 · {selectedCount} selected</caption>
              <thead>
                <tr>
                  <th scope="col">
                    <span>Component</span>
                  </th>
                  <th scope="col">
                    <span>Selection</span>
                  </th>
                  <th scope="col">
                    <span>Cost basis</span>
                  </th>
                  <th scope="col">
                    <span>Evidence</span>
                  </th>
                  <th scope="col" className="num">
                    <span>Est. cost</span>
                  </th>
                  <th scope="col" className="num">
                    <span>Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {LAYERS.map((layer) => {
                  return [
                    <GroupRow
                      key={`${layer.tier}-group`}
                      tier={layer.tier}
                      ctx={ctx}
                      build={build}
                      requirementsKnown={requirementsKnown}
                      onAdd={() => void navigate(`/catalog?layer=${layer.tier}`)}
                    />,
                    ...rowsFor(layer.tier),
                  ];
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="pt-foot">
          <div className="total">
            <span>Estimated total</span>
            <strong>{total ? headline.text.split(' /')[0] : '—'}</strong>
            <small>
              {total
                ? total.coverage === 'complete'
                  ? `/${total.period_days} days · ${mode === 'fixture' ? 'synthetic estimate' : 'estimate'}`
                  : `/${total.period_days} days · lower bound, ${total.unpriced_selection_ids.length} unpriced`
                : 'nothing priced yet'}
            </small>
          </div>
          <span className="pbar-meta">
            {mode === 'fixture'
              ? 'Not a quote · synthetic demo pricebook'
              : 'Estimated baseline · not a quote'}
          </span>
        </div>

        <div className="parts-sections">
          <section aria-labelledby="notes-heading">
            <h2 id="notes-heading" className="parts-h2">
              Compatibility notes
            </h2>
            {!report && build.selections.length && !analysis.evaluation.isError ? (
              <Loading label={`Evaluating revision ${build.revision}…`} />
            ) : (
              <Findings
                report={report}
                lettered={flagged.map((f) => ({ rule_id: f.rule_id, letter: f.letter }))}
              />
            )}
            <div style={{ marginTop: 8 }}>
              <NotEvaluated report={report} />
            </div>
          </section>

          <details className="pdetails">
            <summary>
              <Icon name="chart" /> Cost breakdown ({total?.line_items.length ?? 0} line items)
            </summary>
            <div className="pdetails-body">
              {total ? (
                <>
                  {total.line_items.length ? (
                    <div className="pt-scroll" tabIndex={0} role="region" aria-label="Cost lines">
                      <table className="pt">
                        <thead>
                          <tr>
                            <th scope="col">
                              <span>Selection</span>
                            </th>
                            <th scope="col">
                              <span>Meter</span>
                            </th>
                            <th scope="col" className="num">
                              <span>Qty</span>
                            </th>
                            <th scope="col" className="num">
                              <span>Unit</span>
                            </th>
                            <th scope="col" className="num">
                              <span>Amount</span>
                            </th>
                            <th scope="col">
                              <span>Confidence</span>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {total.line_items.map((li) => {
                            const sel = build.selections.find((s) => s.id === li.selection_id);
                            const item = sel ? byId.get(sel.catalog_item_id) : undefined;
                            return (
                              <tr key={li.id}>
                                <th scope="row">{item?.name ?? li.selection_id}</th>
                                <td>{li.meter.replace(/_/g, ' ')}</td>
                                <td className="num">{li.quantity}</td>
                                <td className="num">
                                  <Money
                                    amount={li.unit_price.amount}
                                    currency={li.unit_price.currency}
                                  />
                                </td>
                                <td className="num">
                                  <Money amount={li.amount.amount} currency={li.amount.currency} />
                                </td>
                                <td>{li.confidence}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <>
                      <p>No line items were reported.</p>
                      {total.coverage !== 'unknown' ? <CostTotals cost={total} /> : null}
                    </>
                  )}
                  <p className="pbox-note" style={{ padding: '8px 0 0' }}>
                    {headline.detail} Unpriced components are never counted as zero.
                  </p>
                </>
              ) : (
                <p className="pbox-note">Nothing has been priced for this revision yet.</p>
              )}
            </div>
          </details>

          <details
            className="pdetails"
            onToggle={(event) => {
              if (event.currentTarget.open) setObjectivesMounted(true);
            }}
          >
            <summary>
              <Icon name="list" /> Objectives and policy
            </summary>
            <div className="pdetails-body">
              {objectivesMounted ? (
                <ObjectivesForm
                  key={build.id}
                  build={build}
                  onDirtyChange={setObjectivesDirty}
                  onApply={(objectives, policy) =>
                    apply(
                      (b) => {
                        const updated = updateObjectives(b, objectives);
                        return Object.keys(policy).length
                          ? { ...updated, policy: { ...b.policy, ...policy } }
                          : updated;
                      },
                      'Updated build objectives',
                      ['workload', 'cost_policy', 'hosting_platform', 'deployment_target'],
                    )
                  }
                />
              ) : null}
            </div>
          </details>

          <details className="pdetails">
            <summary>
              <Icon name="workflow" /> Revision history ({draft.changes.length})
            </summary>
            <div className="pdetails-body">
              <ol className="summary-history">
                {[...draft.changes].reverse().map((c) => (
                  <li key={c.revision}>
                    <span className="mono">r{c.revision}</span>
                    <span>{c.summary}</span>
                    <time className="dim" dateTime={c.at}>
                      {formatRecordedDate(c.at, 'date-time')}
                    </time>
                    {c.revision !== build.revision &&
                    draft.revisions.some((r) => r.revision === c.revision) ? (
                      <button
                        type="button"
                        className="pbtn"
                        aria-label={`Restore revision ${c.revision} as new revision`}
                        onClick={() => restore(c.revision)}
                      >
                        Restore as new revision
                      </button>
                    ) : null}
                  </li>
                ))}
              </ol>
            </div>
          </details>
        </div>
      </div>

      <Modal
        open={jsonOpen}
        title="Your build configuration"
        subtitle="Exported build in JSON format"
        onClose={() => setJsonOpen(false)}
        primaryLabel="Copy JSON"
        onPrimary={
          jsonPreview?.ok
            ? () => {
                void (async () => {
                  try {
                    await navigator.clipboard.writeText(jsonPreview.text);
                    toast('Configuration JSON copied');
                  } catch {
                    toast('Copy was blocked by this browser.');
                  }
                })();
              }
            : undefined
        }
      >
        {jsonPreview?.ok ? (
          <>
            {jsonPreview.problem ? (
              <p className="notice-error json-preview-warning" role="alert">
                This JSON cannot be re-imported. {jsonPreview.problem} You can still copy it as a
                backup.
              </p>
            ) : null}
            <pre id="jsonPreview">{jsonPreview.text}</pre>
          </>
        ) : jsonPreview ? (
          <p className="notice-error json-preview-warning" role="alert">
            {jsonPreview.message}
          </p>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(configureSelection)}
        title={
          configureItem
            ? `Configure ${configureItem.name}`
            : configureSelection
              ? `Configure ${KIND_LABELS[configureSelection.kind]}`
              : 'Configure component'
        }
        subtitle={
          configureSelection &&
          configureItem &&
          configureSelection.catalog_item_version !== configureItem.version
            ? `Contract settings for selected version ${configureSelection.catalog_item_version}; the catalog record may differ.`
            : 'Contract settings for this selection'
        }
        onClose={closeSettings}
      >
        {configureChanged ? (
          <p className="notice-error" role="alert">
            The selection changed while settings were open. Your edits remain here; copy any needed
            values before closing, then reopen settings for the current selection.
          </p>
        ) : null}
        {configureSelection ? (
          <SettingsForm
            kind={configureSelection.kind as ComponentKind}
            values={configureSelection.settings as Record<string, unknown>}
            onDirtyChange={setSettingsDirty}
            onCancel={closeSettings}
            disabledSubmit={configureChanged}
            onApply={(patch) => {
              if (!configure) return false;
              const accepted = apply(
                (b) => updateSettings(b, configureSelection.id, patch),
                `Changed ${KIND_LABELS[configureSelection.kind]} settings`,
                [configureSelection.kind],
                (b) => Boolean(currentConfiguredSelection(b, configure)),
              );
              if (accepted === false) {
                setConfigureError(true);
                return false;
              }
              setSettingsDirty(false);
              setConfigure(null);
              toast('Settings updated. Rules were re-evaluated.');
              return true;
            }}
          />
        ) : null}
      </Modal>
    </div>
  );
}
