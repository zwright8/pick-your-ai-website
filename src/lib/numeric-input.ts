/** Parse decimal input without accepting hexadecimal, binary or partial numeric strings. */
export function parseDecimalInput(raw: string): number {
  const value = raw.trim();
  return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value) ? Number(value) : NaN;
}
