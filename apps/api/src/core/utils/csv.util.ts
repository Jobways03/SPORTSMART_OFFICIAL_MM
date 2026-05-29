/**
 * Convert a list of rows into an RFC 4180 CSV string.
 *
 * Each field that contains a comma, quote, newline, or carriage return is
 * wrapped in double quotes; any interior quote is escaped by doubling it.
 * Null and undefined render as empty strings. Date values render as ISO
 * strings. BigInt / Decimal-like values coerce via String(value).
 *
 * CSV / formula injection (CWE-1236): a cell whose first character is one of
 * `= + - @ TAB CR` is interpreted as a formula by Excel / Google Sheets and
 * can execute (`=HYPERLINK(...)`, `=cmd|'/c calc'!A1`, DDE payloads) when a
 * user opens the file. We neutralise such cells by prefixing a single quote —
 * EXCEPT plain numeric literals (`-100`, `+91`, `12.5`), which are not
 * formulas and must stay machine-readable for the finance exports that share
 * this helper.
 */

const FORMULA_TRIGGER = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^[+-]?\d+(\.\d+)?$/;
const UTF8_BOM = String.fromCharCode(0xfeff);

function neutralizeFormula(raw: string): string {
  if (raw !== '' && FORMULA_TRIGGER.test(raw) && !PLAIN_NUMBER.test(raw)) {
    return `'${raw}`;
  }
  return raw;
}

// Phase 159g — exported so positional CSV builders (e.g. the Form 26Q tax
// exports, which compute cells in CBDT column order) can reuse the same
// RFC-4180 + formula-injection escaping rather than rolling their own.
export function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) return '';
  const raw = neutralizeFormula(
    value instanceof Date ? value.toISOString() : String(value),
  );
  if (/[",\n\r]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

/** A single escaped CSV header line, terminated by a newline. */
export function csvHeaderLine(headers: string[]): string {
  return `${headers.map(escapeCsvField).join(',')}\n`;
}

/**
 * Escaped body rows (no header line), each terminated by a newline. Returns
 * an empty string for an empty batch. Safe to call repeatedly so a handler
 * can stream a large result set one batch at a time instead of buffering it.
 */
export function csvRowLines(
  rows: Array<Record<string, unknown>>,
  headers: string[],
): string {
  if (rows.length === 0) return '';
  return `${rows
    .map((row) => headers.map((h) => escapeCsvField(row[h])).join(','))
    .join('\n')}\n`;
}

/**
 * Build a full CSV string (header + body). Pass `{ bom: true }` to prepend a
 * UTF-8 byte-order mark so Excel on Windows renders non-ASCII content (e.g.
 * Indic / accented names) correctly instead of mojibake.
 */
export function toCsv(
  rows: Array<Record<string, unknown>>,
  headers: string[],
  opts: { bom?: boolean } = {},
): string {
  return `${opts.bom ? UTF8_BOM : ''}${csvHeaderLine(headers)}${csvRowLines(rows, headers)}`;
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

/**
 * Parse an RFC-4180 CSV string into a matrix of cells. Handles quoted fields,
 * escaped quotes (`""`), embedded commas + newlines inside quotes, a leading
 * UTF-8 BOM, and both LF and CRLF line endings. Hand-rolled (the repo has no
 * CSV-parse dependency) and used for the bank-response round-trip ingest.
 */
export function parseCsv(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ',') {
      row.push(field);
      field = '';
      i++;
      continue;
    }
    if (c === '\r') {
      i++;
      continue;
    }
    if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i++;
      continue;
    }
    field += c;
    i++;
  }
  // Flush the trailing field/row if the file didn't end with a newline.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * Parse a CSV into header-keyed records. The first non-empty row is the header;
 * keys are lower-cased + trimmed. Fully-blank rows are dropped. Returns `[]`
 * when there is no header row.
 */
export function parseCsvRecords(input: string): Array<Record<string, string>> {
  const matrix = parseCsv(input).filter((r) => r.some((c) => c.trim() !== ''));
  const headerRow = matrix[0];
  if (!headerRow) return [];
  const headers = headerRow.map((h) => h.trim().toLowerCase());
  return matrix.slice(1).map((r) => {
    const rec: Record<string, string> = {};
    headers.forEach((h, idx) => {
      rec[h] = (r[idx] ?? '').trim();
    });
    return rec;
  });
}
