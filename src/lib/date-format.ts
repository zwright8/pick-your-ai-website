/** Format a recorded timestamp where possible, preserving values such as leap seconds. */
export function formatRecordedDate(timestamp: string, style: 'date' | 'date-time'): string {
  if (!timestamp) return 'unknown date';
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return timestamp;
  return style === 'date'
    ? date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    : date.toLocaleString();
}
