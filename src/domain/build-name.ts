import buildSchema from '../../contracts/v1/schemas/build.schema.json';

export const MAX_BUILD_NAME_CODEPOINTS = buildSchema.properties.name.maxLength;

/** Keep the suffix while respecting the contract's Unicode code-point name limit. */
export function derivedBuildName(name: string, kind: 'copy' | 'recovered'): string {
  const suffix = ` (${kind})`;
  return `${Array.from(name)
    .slice(0, MAX_BUILD_NAME_CODEPOINTS - Array.from(suffix).length)
    .join('')}${suffix}`;
}
