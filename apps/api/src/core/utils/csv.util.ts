/**
 * Convert a list of rows into an RFC 4180 CSV string.
 *
 * Each field that contains a comma, quote, newline, or carriage return is
 * wrapped in double quotes; any interior quote is escaped by doubling it.
 * Null and undefined render as empty strings. Date values render as ISO
 * strings. BigInt / Decimal-like values coerce via String(value).
 */
export function toCsv(rows: Array<Record<string, unknown>>, headers: string[]): string {
  const head = headers.map(escapeCsvField).join(',');
  const body = rows
    .map((row) => headers.map((h) => escapeCsvField(row[h])).join(','))
    .join('\n');
  return body ? `${head}\n${body}\n` : `${head}\n`;
}

function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) return '';
  const raw = value instanceof Date ? value.toISOString() : String(value);
  if (/[",\n\r]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

/**
 * Build an ASCII-only filename fragment: lowercase, digits, underscores.
 * Lets us put it inside `Content-Disposition: attachment; filename="..."`
 * without having to worry about encoding.
 */
export function csvFilenameSlug(parts: Array<string | number | null | undefined>): string {
  return parts
    .filter((p) => p !== null && p !== undefined && p !== '')
    .map((p) => String(p).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''))
    .filter(Boolean)
    .join('_');
}
