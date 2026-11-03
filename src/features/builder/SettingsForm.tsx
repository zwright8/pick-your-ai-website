/* Generic settings form driven by the contract selection schema ($defs/settings_<kind>). */
import { useEffect, useId, useState, type FormEvent } from 'react';
import { fullFormats } from 'ajv-formats/dist/formats.js';
import type { ComponentKind } from '../../contracts';
import { parseDecimalInput } from '../../lib/numeric-input';
import { type FieldDef, settingsFields } from '../../lib/schema-fields';

type Values = Record<string, unknown>;
const INVALID_ARRAY = Symbol('invalid array');

function toInput(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) {
    const simple =
      value.length > 0 &&
      value.every(
        (entry) =>
          typeof entry === 'string' &&
          entry.length > 0 &&
          entry.trim() === entry &&
          !entry.includes(',') &&
          !Array.from(entry).some((character) => {
            const code = character.charCodeAt(0);
            return code < 32 || code === 127;
          }) &&
          !entry.startsWith('['),
      );
    return simple ? value.join(', ') : JSON.stringify(value);
  }
  return String(value);
}

function parse(field: FieldDef, raw: string): unknown {
  if (field.type === 'string') return raw === '' ? undefined : raw;
  const v = raw.trim();
  if (v === '') return undefined;
  switch (field.type) {
    case 'integer':
    case 'number':
      return parseDecimalInput(v);
    case 'boolean':
      return v === 'true';
    case 'string-array':
    case 'enum-array': {
      if (v.startsWith('[')) {
        try {
          const parsed: unknown = JSON.parse(v);
          return Array.isArray(parsed) && parsed.every((entry) => typeof entry === 'string')
            ? parsed
            : INVALID_ARRAY;
        } catch {
          return INVALID_ARRAY;
        }
      }
      return v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }
    default:
      return v;
  }
}

function validate(field: FieldDef, value: unknown): string | null {
  if (value === INVALID_ARRAY) return 'Enter a JSON array of strings or a comma-separated list.';
  if (value === undefined) return field.required ? 'Required by the contract.' : null;
  if ((field.type === 'integer' || field.type === 'number') && !Number.isFinite(value))
    return 'Enter a finite number.';
  if (field.type === 'integer' && !Number.isSafeInteger(value))
    return 'Enter a whole number within the supported range.';
  if (Array.isArray(value) && field.uniqueItems && new Set(value).size !== value.length)
    return 'Remove duplicate entries.';
  if (
    Array.isArray(value) &&
    field.type === 'enum-array' &&
    field.options &&
    value.some((entry) => !field.options?.includes(entry))
  )
    return 'Choose only values allowed by the contract.';
  if (
    typeof value === 'string' &&
    field.format === 'uri' &&
    !(fullFormats.uri as (value: string) => boolean)(value)
  )
    return 'Enter a valid absolute URI.';
  if (typeof value === 'number' && field.minimum !== undefined && value < field.minimum)
    return `Minimum is ${field.minimum}.`;
  if (typeof value === 'number' && field.maximum !== undefined && value > field.maximum)
    return `Maximum is ${field.maximum}.`;
  if (
    typeof value === 'number' &&
    field.exclusiveMinimum !== undefined &&
    value <= field.exclusiveMinimum
  )
    return `Must be greater than ${field.exclusiveMinimum}.`;
  if (
    typeof value === 'number' &&
    field.exclusiveMaximum !== undefined &&
    value >= field.exclusiveMaximum
  )
    return `Must be less than ${field.exclusiveMaximum}.`;
  if (typeof value === 'string' && field.pattern && !new RegExp(field.pattern).test(value)) {
    return field.key.endsWith('_ref') || field.key.includes('secret')
      ? 'Must be an opaque secret:// reference — never paste a credential.'
      : `Must match ${field.pattern}.`;
  }
  return null;
}

export function SettingsForm({
  kind,
  values,
  onApply,
  onCancel,
  onDirtyChange,
  disabledSubmit = false,
}: {
  kind: ComponentKind;
  values: Values;
  onApply: (patch: Values) => boolean | void;
  onCancel: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  disabledSubmit?: boolean;
}) {
  const fields = settingsFields(kind);
  const formId = useId();
  // Keep only explicit edits so untouched fields follow a newer accepted build snapshot.
  const initial = Object.fromEntries(
    fields.map((field) => [field.key, toInput(values[field.key])]),
  );
  const [edits, setEdits] = useState<Record<string, string>>({});
  const draft = { ...initial, ...edits };
  const [errors, setErrors] = useState<Record<string, string>>({});
  const dirty = Object.entries(edits).some(([key, value]) => value !== initial[key]);
  const setField = (key: string, value: string) => {
    setEdits((previous) => {
      const next = { ...previous };
      if (value === initial[key]) delete next[key];
      else next[key] = value;
      return next;
    });
  };
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  if (!fields.length) {
    return <p className="muted">This component has no configurable settings in contract v1.</p>;
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (disabledSubmit) return;
    const patch: Values = {};
    const errs: Record<string, string> = {};
    for (const f of fields) {
      const changed = Object.hasOwn(edits, f.key) && edits[f.key] !== initial[f.key];
      const value = changed ? parse(f, draft[f.key] ?? '') : values[f.key];
      const err = validate(f, value);
      if (err) errs[f.key] = err;
      if (changed) patch[f.key] = value;
    }
    setErrors(errs);
    if (Object.keys(errs).length) return;
    if (onApply(patch) !== false) setEdits({});
  };

  return (
    <form onSubmit={submit} noValidate aria-label="Component settings" className="settings-grid">
      {fields.map((f) => {
        const id = `${formId}-${f.key}`;
        const errId = `${id}-err`;
        const hintId = `${id}-hint`;
        const arrayField = f.type === 'string-array' || f.type === 'enum-array';
        const describedBy = [arrayField ? hintId : null, errors[f.key] ? errId : null]
          .filter(Boolean)
          .join(' ');
        const common = {
          id,
          'aria-invalid': errors[f.key] ? true : undefined,
          'aria-describedby': describedBy || undefined,
        } as const;
        return (
          <div key={f.key}>
            <label htmlFor={id} className="field-label">
              {f.label}
              {f.required ? <span aria-hidden="true"> *</span> : null}
              {f.required ? <span className="sr-only"> (required)</span> : null}
            </label>
            {f.type === 'enum' || f.type === 'boolean' ? (
              <select
                {...common}
                className="control-input"
                value={draft[f.key] ?? ''}
                onChange={(e) => setField(f.key, e.target.value)}
              >
                <option value="">Not set</option>
                {(f.type === 'boolean' ? ['true', 'false'] : (f.options ?? [])).map((o) => (
                  <option key={o} value={o}>
                    {f.type === 'boolean' ? (o === 'true' ? 'Yes' : 'No') : o.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            ) : (
              <input
                {...common}
                className="control-input"
                inputMode={f.type === 'integer' || f.type === 'number' ? 'decimal' : undefined}
                value={draft[f.key] ?? ''}
                placeholder={
                  f.key.includes('credential') || f.key.endsWith('_key_ref')
                    ? 'secret://…'
                    : undefined
                }
                onChange={(e) => setField(f.key, e.target.value)}
              />
            )}
            {arrayField ? (
              <p id={hintId} className="hint-text">
                Comma-separated, or a JSON array of strings for commas, empty values or empty lists.
              </p>
            ) : null}
            {errors[f.key] ? (
              <p id={errId} className="field-error">
                {errors[f.key]}
              </p>
            ) : null}
          </div>
        );
      })}
      <div className="settings-actions">
        <button
          type="submit"
          className="btn btn-primary"
          disabled={disabledSubmit}
          aria-describedby={disabledSubmit ? `${formId}-blocked` : undefined}
        >
          Apply settings
        </button>
        <button type="button" className="btn btn-outline" onClick={onCancel}>
          Cancel
        </button>
      </div>
      {disabledSubmit ? (
        <p id={`${formId}-blocked`} className="hint-text">
          Selection changed. Reopen settings to apply.
        </p>
      ) : null}
      <p className="hint-text">
        Applying creates a new build revision and re-runs every affected check.
      </p>
    </form>
  );
}
