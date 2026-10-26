import { toCsv, type CsvValue } from '@lemlist/shared';

/**
 * Save a table the page already has as a CSV file, with no server round
 * trip: the numbers in the file are the numbers on the screen, because
 * they are the same objects.
 *
 * Every cell goes through the shared csvCell, which neutralises text that
 * a spreadsheet would run as a formula (= + - @).
 */
export function downloadCsv(filename: string, header: readonly string[], rows: readonly (readonly CsvValue[])[]): void {
  // A byte-order mark so Excel reads accented names as UTF-8 rather than mojibake.
  const blob = new Blob(['﻿', toCsv(header, rows)], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  // Revoked a moment later: some browsers start the download after click returns.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Today as YYYY-MM-DD, for file names. */
export function csvDate(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}
