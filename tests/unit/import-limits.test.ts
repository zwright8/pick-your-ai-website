// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { validatorsReady } from '../../src/contracts';
import { apiChat, NOW } from './scenarios';
import {
  decodeShareFragment,
  encodeShareFragment,
  exportBuild,
  exportBuildJson,
  exportFileImportProblem,
  importBuild,
  importBuildFile,
  MAX_IMPORT_BYTES,
  MAX_SHARE_BYTES,
} from '../../src/domain/share';

describe('build import limits', () => {
  it('counts UTF-8 bytes rather than UTF-16 characters', () => {
    const text = JSON.stringify('😀'.repeat(Math.floor(MAX_IMPORT_BYTES / 4) + 1));
    expect(text.length).toBeLessThan(MAX_IMPORT_BYTES);
    expect(importBuild(text, 'fixture')).toEqual({
      ok: false,
      error: 'File is larger than 5 MB.',
    });
  });

  it('accepts a valid import at the exact byte limit', async () => {
    await validatorsReady;
    const build = apiChat();
    build.extensions = { x_padding: '' };
    const size = new TextEncoder().encode(
      JSON.stringify(exportBuild(build, 'fixture', NOW)),
    ).byteLength;
    build.extensions.x_padding = 'a'.repeat(MAX_IMPORT_BYTES - size);
    const text = JSON.stringify(exportBuild(build, 'fixture', NOW));
    expect(new TextEncoder().encode(text).byteLength).toBe(MAX_IMPORT_BYTES);
    const reader = vi.fn(async () => text);
    const result = await importBuildFile({ size: MAX_IMPORT_BYTES, text: reader }, 'fixture');
    expect(result.ok && result.build).toEqual(build);
    expect(reader).toHaveBeenCalledOnce();
  });

  it('rejects an oversized file before reading it', async () => {
    const text = vi.fn(async () => '{}');
    await expect(importBuildFile({ size: MAX_IMPORT_BYTES + 1, text }, 'fixture')).resolves.toEqual(
      {
        ok: false,
        error: 'File is larger than 5 MB.',
      },
    );
    expect(text).not.toHaveBeenCalled();
  });

  it('reports a file read failure', async () => {
    const text = vi.fn(async () => {
      throw new Error('read failed');
    });
    await expect(importBuildFile({ size: 10, text }, 'fixture')).resolves.toEqual({
      ok: false,
      error: 'Could not read the file.',
    });
  });

  it('rejects oversized share fragments before decoding', () => {
    const decode = vi.spyOn(globalThis, 'atob');
    try {
      const fragment = `b1.${'A'.repeat(Math.ceil(MAX_SHARE_BYTES / 3) * 4 + 1)}`;
      expect(decodeShareFragment(fragment, 'fixture')).toEqual({
        ok: false,
        error: 'The shared link is too large.',
      });
      expect(decode).not.toHaveBeenCalled();
    } finally {
      decode.mockRestore();
    }
  });

  it('refuses to create a link that the shared-build page cannot open', async () => {
    await validatorsReady;
    const build = apiChat();
    build.extensions = { x_padding: '😀'.repeat(MAX_SHARE_BYTES / 4) };
    const encode = vi.spyOn(globalThis, 'btoa');
    try {
      expect(() => encodeShareFragment(build, 'fixture')).toThrow(/too large/i);
      expect(encode).not.toHaveBeenCalled();
    } finally {
      encode.mockRestore();
    }
  });

  it('creates a usable link at the exact byte limit', async () => {
    await validatorsReady;
    const build = apiChat();
    build.extensions = { x_padding: '' };
    const size = new TextEncoder().encode(JSON.stringify(exportBuild(build, 'fixture'))).byteLength;
    build.extensions.x_padding = 'a'.repeat(MAX_SHARE_BYTES - size);
    const result = decodeShareFragment(encodeShareFragment(build, 'fixture'), 'fixture');
    expect(result.ok && result.build).toEqual(build);
  });

  it('rejects decoded link bytes just over the link limit, even when base64 length rounds down', () => {
    const fragment = `b1.${Buffer.alloc(MAX_SHARE_BYTES + 1, 65).toString('base64url')}`;
    expect(decodeShareFragment(fragment, 'fixture')).toEqual({
      ok: false,
      error: 'The shared link is too large.',
    });
  });

  it('imports an exported file larger than the share-link limit', async () => {
    await validatorsReady;
    const build = apiChat();
    build.extensions = { x_padding: '😀'.repeat(MAX_SHARE_BYTES / 4) };
    const json = JSON.stringify(exportBuild(build, 'fixture', NOW), null, 2) + '\n';
    const bytes = new TextEncoder().encode(json).byteLength;
    expect(bytes).toBeGreaterThan(MAX_SHARE_BYTES);
    const result = await importBuildFile({ size: bytes, text: async () => json }, 'fixture');
    expect(result.ok && result.build).toEqual(build);
  });

  it('compacts a formatted export when only whitespace would exceed the file limit', async () => {
    await validatorsReady;
    const build = apiChat();
    let nested: unknown = Array.from({ length: 45_000 }, () => 'x');
    for (let i = 0; i < 60; i++) nested = [nested];
    build.extensions = { x_nested: nested };
    const formatted = JSON.stringify(exportBuild(build, 'fixture', NOW), null, 2) + '\n';
    expect(new TextEncoder().encode(formatted).byteLength).toBeGreaterThan(MAX_IMPORT_BYTES);
    const json = exportBuildJson(build, 'fixture', NOW);
    expect(exportFileImportProblem(json)).toBeNull();
    const imported = importBuild(json, 'fixture');
    expect(imported.ok && imported.build).toEqual(build);
  });

  it('retains readable formatting when the export fits', async () => {
    await validatorsReady;
    expect(exportBuildJson(apiChat(), 'fixture', NOW)).toContain('\n  "format"');
  });

  it('preserves the full backup and reports when compact JSON is still too large', async () => {
    await validatorsReady;
    const build = apiChat();
    const value = 'x'.repeat(MAX_IMPORT_BYTES);
    build.extensions = { x_padding: value };
    const json = exportBuildJson(build, 'fixture', NOW);
    expect(exportFileImportProblem(json)).toBe('File is larger than 5 MB.');
    expect(JSON.parse(json).build.extensions.x_padding).toBe(value);
  });

  it('reports an excessively nested imported extension without throwing', async () => {
    await validatorsReady;
    const base = JSON.stringify(apiChat());
    const nested = '['.repeat(5000) + '0' + ']'.repeat(5000);
    const text = `${base.slice(0, -1)},"extensions":{"x_deep":${nested}}}`;
    expect(importBuild(text, 'fixture')).toEqual({
      ok: false,
      error: 'Build data is nested too deeply to import safely.',
    });
  });

  it.each([
    [98, true],
    [99, false],
  ])('limits actual JSON containers, allowing %i nested arrays: %s', async (depth, accepted) => {
    await validatorsReady;
    const base = JSON.stringify(apiChat());
    const nested = '['.repeat(depth) + '0' + ']'.repeat(depth);
    const literal = JSON.stringify('text with \\" quotes, braces {} and brackets []');
    const text = `${base.slice(0, -1)},"extensions":{"x_text":${literal},"x_deep":${nested}}}`;
    expect(importBuild(text, 'fixture').ok).toBe(accepted);
  });

  it('reports deep backups and refuses links that could not be imported', async () => {
    await validatorsReady;
    const build = apiChat();
    build.extensions = { x_deep: JSON.parse('['.repeat(120) + '0' + ']'.repeat(120)) };
    const json = JSON.stringify(exportBuild(build, 'fixture', NOW), null, 2);
    expect(exportFileImportProblem(json)).toMatch(/nested too deeply/);
    expect(() => encodeShareFragment(build, 'fixture')).toThrow(/nested too deeply/);
  });

  it('round-trips a bare build at the nesting limit through an export and share link', async () => {
    await validatorsReady;
    const base = JSON.stringify(apiChat());
    const nested = '['.repeat(98) + '0' + ']'.repeat(98);
    const text = `${base.slice(0, -1)},"extensions":{"x_deep":${nested}}}`;
    const imported = importBuild(text, 'fixture');
    expect(imported.ok).toBe(true);
    if (!imported.ok) throw new Error(imported.error);
    const json = JSON.stringify(exportBuild(imported.build, 'fixture', NOW));
    expect(exportFileImportProblem(json)).toBeNull();
    expect(importBuild(json, 'fixture').ok).toBe(true);
    expect(decodeShareFragment(encodeShareFragment(imported.build, 'fixture'), 'fixture').ok).toBe(
      true,
    );
  });

  it('still rejects an envelope whose build exceeds the nesting limit', async () => {
    await validatorsReady;
    const build = apiChat();
    build.extensions = { x_deep: JSON.parse('['.repeat(99) + '0' + ']'.repeat(99)) };
    const json = JSON.stringify(exportBuild(build, 'fixture', NOW));
    expect(importBuild(json, 'fixture')).toMatchObject({
      ok: false,
      error: 'Build data is nested too deeply to import safely.',
    });
    expect(() => encodeShareFragment(build, 'fixture')).toThrow(/nested too deeply/);
  });
});
