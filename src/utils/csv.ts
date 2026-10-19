/**
 * RFC 4180 CSV serialization with spreadsheet formula-injection guards.
 *
 * Every field is quoted with embedded quotes doubled, so commas and
 * newlines in names/companies can't shift columns; fields starting with
 * = + - @ tab or CR are prefixed with a quote so Excel/Sheets render them
 * as text instead of executing them (contact names arrive from mail
 * headers and CSVs, i.e. from strangers).
 */
function escapeCell(value: unknown): string {
  let cell = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(cell)) {
    cell = `'${cell}`;
  }
  return `"${cell.replace(/"/g, '""')}"`;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows]
    .map((row) => row.map(escapeCell).join(','))
    .join('\r\n');
}
