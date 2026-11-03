// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../..', import.meta.url));
const script = `
  const { parser } = require('typescript-eslint');
  const path = require('node:path');
  const result = parser.parseForESLint('const value = 1', {
    filePath: path.join(process.cwd(), 'eslint.config.js'),
    tsconfigRootDir: process.cwd(),
    projectService: { allowDefaultProject: [process.argv[1]] },
  });
  if (!result.services.program) throw new Error('Missing project service program');
`;

function parse(pattern: string) {
  return spawnSync(process.execPath, ['-e', script, pattern], {
    cwd: root,
    encoding: 'utf8',
    timeout: 20_000,
  });
}

describe('TypeScript project-service glob compatibility', () => {
  it('admits matching default-project files', () => {
    const result = parse('*.js');
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
  });

  it('rejects files outside the allowed pattern', () => {
    const result = parse('*.ts');
    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('was not found by the project service');
  });
});
