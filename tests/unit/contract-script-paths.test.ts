// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const repository = fileURLToPath(new URL('../..', import.meta.url));
let fixture: string;

beforeAll(() => {
  // Keep the fixture under node_modules so the copied generator resolves project dependencies.
  fixture = mkdtempSync(join(repository, 'node_modules', 'contract path é-'));
  cpSync(join(repository, 'contracts'), join(fixture, 'contracts'), { recursive: true });
  mkdirSync(join(fixture, 'scripts'));
  for (const script of ['contracts.mjs', 'generate-contract-types.mjs']) {
    copyFileSync(join(repository, 'scripts', script), join(fixture, 'scripts', script));
  }
});

afterAll(() => rmSync(fixture, { recursive: true, force: true }));

describe('contract scripts in paths containing spaces and Unicode', () => {
  it('verifies the vendored contract', () => {
    const result = spawnSync(process.execPath, ['scripts/contracts.mjs', 'verify'], {
      cwd: fixture,
      encoding: 'utf8',
      timeout: 20_000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain('46 files intact');
  });

  it('generates the same types and validators', () => {
    const result = spawnSync(process.execPath, ['scripts/generate-contract-types.mjs'], {
      cwd: fixture,
      encoding: 'utf8',
      timeout: 60_000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stdout + result.stderr).toBe(0);
    for (const file of ['contract-types.ts', 'validators.js', 'validators.d.ts']) {
      const path = join('src/contracts/generated', file);
      expect(readFileSync(join(fixture, path))).toEqual(readFileSync(join(repository, path)));
    }
  }, 70_000);
});
