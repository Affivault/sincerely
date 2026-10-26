/* ═══════════════════════════════════════════════════════════════════════
   One way to write a CSV cell.

   Five pages each had their own csvCell, and none of them guarded against
   formula injection: a contact imported as `=HYPERLINK("http://x","Click")`
   or a campaign named `+cmd|...` is a live formula the moment the export
   is opened in Excel or Sheets. The server's campaign report guarded the
   email column and not the campaign name printed above it.

   So the rule lives here once. Text that starts with = + - @ (or a tab or
   carriage return, which some spreadsheets strip before reading the rest)
   gets a leading apostrophe, which spreadsheets show as plain text. Real
   numbers are left alone: -3 is a number, not an attack, and quoting it
   would turn every negative figure into text that cannot be summed.
   ═══════════════════════════════════════════════════════════════════════ */

export type CsvValue = string | number | boolean | null | undefined;

const FORMULA_START = /^[=+\-@\t\r]/;

/** One cell, escaped and neutralised. */
export function csvCell(v: CsvValue): string {
  if (v == null) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  let s = String(v);
  if (FORMULA_START.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** A whole sheet: a header row and the rows under it. */
export function toCsv(header: readonly string[], rows: readonly (readonly CsvValue[])[]): string {
  return [header.map(csvCell).join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\n');
}
