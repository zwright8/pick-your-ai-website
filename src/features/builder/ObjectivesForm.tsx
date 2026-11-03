/* Build-level objectives and policy (contract build.schema.json `objectives` and `policy`). */
import { useEffect, useId, useState, type FormEvent } from 'react';
import type { BuildSnapshot } from '../../contracts';
import { DEMO_REGIONS } from '../../data/fixture/catalog';
import { parseDecimalInput } from '../../lib/numeric-input';

type Objectives = BuildSnapshot['objectives'];
type Policy = NonNullable<BuildSnapshot['policy']>;

const NUMERIC: { key: keyof Objectives; label: string; min: number }[] = [
  { key: 'requests_per_day', label: 'Requests per day', min: 0 },
  { key: 'avg_input_tokens', label: 'Average input tokens', min: 0 },
  { key: 'avg_output_tokens', label: 'Average output tokens', min: 0 },
  { key: 'max_concurrency', label: 'Max concurrency', min: 1 },
  { key: 'max_latency_ms', label: 'Max latency (ms)', min: 1 },
];
const HINTS: Record<string, string> = {
  region: 'Demo regions: ' + DEMO_REGIONS.join(', '),
  monthly_budget_amount:
    'Checked only with a cost policy that enforces a hard cap, and only against a complete quote.',
};

export function ObjectivesForm({
  build,
  onApply,
  onDirtyChange,
}: {
  build: BuildSnapshot;
  onApply: (objectives: Partial<Objectives>, policy: Partial<Policy>) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const id = useId();
  const o = build.objectives;
  const initial: Record<string, string> = {
    region: o.region,
    currency: o.currency,
    data_classification: o.data_classification,
    monthly_budget_amount: o.monthly_budget_amount ?? '',
    ...Object.fromEntries(
      NUMERIC.map((n) => [n.key, o[n.key] === undefined ? '' : String(o[n.key])]),
    ),
    fail_on_unknown: String(build.policy?.fail_on_unknown ?? false),
    min_resource_confidence: build.policy?.min_resource_confidence ?? 'calibrated',
  };
  const [edits, setEdits] = useState<Record<string, string>>({});
  const form = { ...initial, ...edits };
  const dirty = Object.entries(edits).some(([key, value]) => value !== initial[key]);
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: string) => (e: { target: { value: string } }) => {
    const value = e.target.value;
    setEdits((previous) => {
      const next = { ...previous };
      if (value === initial[k]) delete next[k];
      else next[k] = value;
      return next;
    });
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    const changed = (key: string) => Object.hasOwn(edits, key) && edits[key] !== initial[key];
    if (changed('region') && !form.region) errs.region = 'Region is required.';
    if (changed('currency') && !/^[A-Z]{3}$/.test(form.currency ?? ''))
      errs.currency = 'Use a three-letter ISO currency code, e.g. USD.';
    if (
      changed('monthly_budget_amount') &&
      form.monthly_budget_amount &&
      !/^(0|[1-9][0-9]*)(\.[0-9]{1,12})?$/.test(form.monthly_budget_amount)
    ) {
      errs.monthly_budget_amount = 'Enter a non-negative decimal such as 500 or 500.00.';
    }
    const numeric: Partial<Objectives> = {};
    for (const n of NUMERIC) {
      if (!changed(n.key)) continue;
      const raw = (form[n.key] ?? '').trim();
      if (raw === '') {
        (numeric as Record<string, unknown>)[n.key] = undefined;
        continue;
      }
      const v = parseDecimalInput(raw);
      if (!Number.isSafeInteger(v) || v < n.min)
        errs[n.key] = `Enter a whole number ≥ ${n.min} within the supported range.`;
      else (numeric as Record<string, unknown>)[n.key] = v;
    }
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const objectives: Partial<Objectives> = { ...numeric };
    if (changed('region')) objectives.region = form.region;
    if (changed('currency')) objectives.currency = form.currency;
    if (changed('data_classification'))
      objectives.data_classification =
        form.data_classification as Objectives['data_classification'];
    if (changed('monthly_budget_amount'))
      objectives.monthly_budget_amount = form.monthly_budget_amount || undefined;
    const policy: Partial<Policy> = {};
    if (changed('fail_on_unknown')) policy.fail_on_unknown = form.fail_on_unknown === 'true';
    if (changed('min_resource_confidence'))
      policy.min_resource_confidence =
        form.min_resource_confidence as Policy['min_resource_confidence'];
    onApply(objectives, policy);
    setEdits({});
  };

  const field = (key: string, label: string, input: React.ReactNode) => (
    <div key={key}>
      <label htmlFor={`${id}-${key}`} className="field-label">
        {label}
      </label>
      {input}
      {HINTS[key] ? (
        <p id={`${id}-${key}-hint`} className="hint-text">
          {HINTS[key]}
        </p>
      ) : null}
      {errors[key] ? (
        <p id={`${id}-${key}-err`} className="field-error">
          {errors[key]}
        </p>
      ) : null}
    </div>
  );
  const a11y = (key: string) => {
    const describedBy = [
      HINTS[key] ? `${id}-${key}-hint` : null,
      errors[key] ? `${id}-${key}-err` : null,
    ]
      .filter(Boolean)
      .join(' ');
    return {
      id: `${id}-${key}`,
      'aria-invalid': errors[key] ? true : undefined,
      'aria-describedby': describedBy || undefined,
    };
  };

  return (
    <form
      onSubmit={submit}
      noValidate
      aria-label="Build objectives"
      className="settings-grid three"
    >
      {field(
        'region',
        'Region / residency',
        <input
          {...a11y('region')}
          className="control-input"
          list={`${id}-regions`}
          value={form.region}
          onChange={set('region')}
        />,
      )}
      <datalist id={`${id}-regions`}>
        {DEMO_REGIONS.map((r) => (
          <option key={r} value={r} />
        ))}
      </datalist>
      {field(
        'currency',
        'Currency',
        <input
          {...a11y('currency')}
          className="control-input"
          value={form.currency}
          onChange={set('currency')}
          maxLength={3}
        />,
      )}
      {field(
        'data_classification',
        'Data classification',
        <select
          {...a11y('data_classification')}
          className="control-input"
          value={form.data_classification}
          onChange={set('data_classification')}
        >
          {['public', 'internal', 'confidential', 'restricted'].map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>,
      )}
      {field(
        'monthly_budget_amount',
        'Monthly budget',
        <input
          {...a11y('monthly_budget_amount')}
          className="control-input"
          inputMode="decimal"
          value={form.monthly_budget_amount}
          onChange={set('monthly_budget_amount')}
        />,
      )}
      {NUMERIC.map((n) =>
        field(
          n.key,
          n.label,
          <input
            {...a11y(n.key)}
            className="control-input"
            inputMode="numeric"
            value={form[n.key]}
            onChange={set(n.key)}
          />,
        ),
      )}
      {field(
        'min_resource_confidence',
        'Minimum capacity-evidence confidence',
        <select
          {...a11y('min_resource_confidence')}
          className="control-input"
          value={form.min_resource_confidence}
          onChange={set('min_resource_confidence')}
        >
          {['estimated', 'calibrated', 'verified'].map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>,
      )}
      {field(
        'fail_on_unknown',
        'Treat any unknown as blocking',
        <select
          {...a11y('fail_on_unknown')}
          className="control-input"
          value={form.fail_on_unknown}
          onChange={set('fail_on_unknown')}
        >
          <option value="false">No — unknowns need review</option>
          <option value="true">Yes — unknowns block readiness</option>
        </select>,
      )}
      <div className="settings-actions">
        <button type="submit" className="btn btn-primary">
          Apply objectives
        </button>
      </div>
    </form>
  );
}
