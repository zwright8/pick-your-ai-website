/*
 * Build import/export and share-by-URL (preview). An export file wraps a contract BuildSnapshot
 * with provenance so another browser can reproduce it. Imports are validated against the contract
 * schema and never executed or rendered as HTML. Share links carry the build in the URL fragment
 * (#…), which browsers do not send to the server.
 */
import type { BuildSnapshot } from '../contracts';
import { CONTRACT_PROVENANCE, validateContract, validatorsReady } from '../contracts';
import { MIN_SELECTIONS_FOR_SNAPSHOT } from './build';

export const EXPORT_FORMAT = 'pickyour.ai/build-export';
export const EXPORT_FORMAT_VERSION = 1;
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
export const MAX_SHARE_BYTES = 512 * 1024;
const MAX_JSON_DEPTH = 100;

export interface BuildExport {
  format: typeof EXPORT_FORMAT;
  formatVersion: typeof EXPORT_FORMAT_VERSION;
  exportedAt: string;
  contract: { version: string; sourceSha: string };
  dataMode: 'fixture' | 'http';
  build: BuildSnapshot;
}

export type ImportResult =
  { ok: true; build: BuildSnapshot; warnings: string[] } | { ok: false; error: string };

export function canExport(build: BuildSnapshot): string | null {
  if (build.selections.length < MIN_SELECTIONS_FOR_SNAPSHOT) {
    return `Add at least ${MIN_SELECTIONS_FOR_SNAPSHOT} components before exporting.`;
  }
  const result = validateContract('BuildSnapshot', build);
  return result.ok ? null : result.summary;
}

export function exportBuild(
  build: BuildSnapshot,
  dataMode: 'fixture' | 'http',
  now: string = new Date().toISOString(),
): BuildExport {
  const problem = canExport(build);
  if (problem) throw new Error(problem);
  return {
    format: EXPORT_FORMAT,
    formatVersion: EXPORT_FORMAT_VERSION,
    exportedAt: now,
    contract: {
      version: CONTRACT_PROVENANCE.contractVersion,
      sourceSha: CONTRACT_PROVENANCE.sourceSha,
    },
    dataMode,
    build,
  };
}

export function exportFileName(build: BuildSnapshot): string {
  const slug = build.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  return `${slug || 'build'}.r${build.revision}.pickyour-ai.json`;
}

function exportFileExceedsImportLimit(text: string): boolean {
  return (
    text.length > MAX_IMPORT_BYTES || new TextEncoder().encode(text).byteLength > MAX_IMPORT_BYTES
  );
}

function describeMetadata(value: unknown): string {
  return value === null || ['string', 'number', 'boolean', 'undefined'].includes(typeof value)
    ? String(value)
    : 'invalid value';
}

/** Count JSON containers without recursing or treating brackets inside strings as structure. */
function exceedsJsonDepth(text: string, limit: number): boolean {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (const char of text) {
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === '[' || char === '{') {
      if (++depth > limit) return true;
    } else if (char === ']' || char === '}') depth--;
  }
  return false;
}

/** Exports remain downloadable as backups even when they exceed an import guard. */
export function exportFileImportProblem(text: string): string | null {
  if (exportFileExceedsImportLimit(text)) return 'File is larger than 5 MB.';
  if (exceedsJsonDepth(text, MAX_JSON_DEPTH + 1))
    return 'Build data is nested too deeply to import safely.';
  return null;
}

/** Keep readable JSON unless compact formatting makes an otherwise oversized export importable. */
export function exportBuildJson(
  build: BuildSnapshot,
  dataMode: 'fixture' | 'http',
  now: string = new Date().toISOString(),
): string {
  const envelope = exportBuild(build, dataMode, now);
  const formatted = JSON.stringify(envelope, null, 2) + '\n';
  if (!exportFileExceedsImportLimit(formatted)) return formatted;
  const compact = JSON.stringify(envelope) + '\n';
  return exportFileImportProblem(compact) ? formatted : compact;
}

/** Accepts an export envelope or a bare BuildSnapshot. */
export function importBuild(text: string, currentMode: 'fixture' | 'http'): ImportResult {
  const problem = exportFileImportProblem(text);
  if (problem) return { ok: false, error: problem };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: 'File is not valid JSON.' };
  }
  if (!data || typeof data !== 'object')
    return { ok: false, error: 'File does not contain a build.' };
  const warnings: string[] = [];
  let candidate: unknown = data;
  const env = data as Partial<BuildExport>;
  if (!('format' in env) && exceedsJsonDepth(text, MAX_JSON_DEPTH)) {
    return { ok: false, error: 'Build data is nested too deeply to import safely.' };
  }
  if ('format' in env) {
    if (env.format !== EXPORT_FORMAT)
      return { ok: false, error: `Unsupported file format "${describeMetadata(env.format)}".` };
    if (env.formatVersion !== EXPORT_FORMAT_VERSION) {
      return {
        ok: false,
        error: `Unsupported export version ${describeMetadata(env.formatVersion)}.`,
      };
    }
    if (env.contract?.version !== CONTRACT_PROVENANCE.contractVersion) {
      return {
        ok: false,
        error: `Build uses contract ${describeMetadata(env.contract?.version)}; this site uses ${CONTRACT_PROVENANCE.contractVersion}.`,
      };
    }
    if (env.dataMode && env.dataMode !== currentMode) {
      warnings.push(
        `This build was made with ${describeMetadata(env.dataMode)} data; this site is in ${currentMode} mode, so components may not resolve.`,
      );
    }
    candidate = env.build;
  }
  const result = validateContract('BuildSnapshot', candidate);
  if (!result.ok) return { ok: false, error: result.summary };
  return { ok: true, build: result.value, warnings };
}

/** Reject oversized files before loading them into memory. */
export async function importBuildFile(
  file: Pick<Blob, 'size' | 'text'>,
  currentMode: 'fixture' | 'http',
): Promise<ImportResult> {
  if (file.size > MAX_IMPORT_BYTES) return { ok: false, error: 'File is larger than 5 MB.' };
  let text: string;
  try {
    text = await file.text();
  } catch {
    return { ok: false, error: 'Could not read the file.' };
  }
  try {
    await validatorsReady;
  } catch {
    return { ok: false, error: 'Could not load build validation. Reload the page and try again.' };
  }
  return importBuild(text, currentMode);
}

// ---- share-by-URL (fragment) -------------------------------------------------------------

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export function encodeShareFragment(build: BuildSnapshot, dataMode: 'fixture' | 'http'): string {
  const json = JSON.stringify(exportBuild(build, dataMode));
  const bytes = new TextEncoder().encode(json);
  if (bytes.byteLength > MAX_SHARE_BYTES) {
    throw new Error('This build is too large to share as a link.');
  }
  if (exceedsJsonDepth(json, MAX_JSON_DEPTH + 1)) {
    throw new Error('This build is nested too deeply to share as a link.');
  }
  return `b1.${toBase64Url(bytes)}`;
}

export function decodeShareFragment(
  fragment: string,
  currentMode: 'fixture' | 'http',
): ImportResult {
  const raw = fragment.replace(/^#/, '');
  if (!raw.startsWith('b1.'))
    return { ok: false, error: 'This link does not contain a PickYour.AI build.' };
  if (raw.length - 3 > Math.ceil(MAX_SHARE_BYTES / 3) * 4) {
    return { ok: false, error: 'The shared link is too large.' };
  }
  let text: string;
  try {
    const bytes = fromBase64Url(raw.slice(3));
    if (bytes.byteLength > MAX_SHARE_BYTES)
      return { ok: false, error: 'The shared link is too large.' };
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, error: 'The shared link is corrupted.' };
  }
  return importBuild(text, currentMode);
}
