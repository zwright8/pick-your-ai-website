import { expect, it } from 'vitest';
import schema from '../../contracts/v1/schemas/build.schema.json';
import { derivedBuildName } from '../../src/domain/build-name';
import { rename } from '../../src/domain/build';
import { validateContract } from '../../src/contracts';
import { apiChat } from './scenarios';

it.each(['copy', 'recovered'] as const)(
  'keeps the %s suffix within the contract limit for Unicode names',
  (kind) => {
    const limit = schema.properties.name.maxLength;
    const original = '😀'.repeat(limit);
    const result = derivedBuildName(original, kind);
    expect(Array.from(result)).toHaveLength(limit);
    expect(validateContract('BuildSnapshot', { ...apiChat(), name: result }).ok).toBe(true);
    expect(result).toBe(`${'😀'.repeat(limit - Array.from(` (${kind})`).length)} (${kind})`);
    expect(derivedBuildName('Short name', kind)).toBe(`Short name (${kind})`);
  },
);

it('renames using the contract limit without splitting Unicode characters', () => {
  const limit = schema.properties.name.maxLength;
  const build = rename(apiChat(), '😀'.repeat(limit + 1));
  expect(build.name).toBe('😀'.repeat(limit));
  expect(validateContract('BuildSnapshot', build).ok).toBe(true);
});
