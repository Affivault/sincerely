import Papa from 'papaparse';
import type { CsvValue } from '@lemlist/shared';

/**
 * Every way a list gets into the import: a CSV/TSV file, an Excel
 * workbook, or rows pasted straight from a spreadsheet. All three come
 * out the same shape - header names and one object per row - so the
 * planner never knows or cares which it was.
 */
export interface ParsedSheet {
  headers: string[];
  rows: Record<string, string>[];
}

const EXCEL_RE = /\.(xlsx|xlsm)$/i;
const TEXT_RE = /\.(csv|tsv|txt)$/i;

export function isSupportedFile(name: string): boolean {
  return EXCEL_RE.test(name) || TEXT_RE.test(name);
}

/** Header names, tidied, with blanks and repeats made unique so no column is lost. */
function uniqueHeaders(raw: unknown[]): string[] {
  const seen = new Map<string, number>();
  return raw.map((h, i) => {
    let name = String(h ?? '').replace(/^﻿/, '').trim() || `Column ${i + 1}`;
    const n = seen.get(name.toLowerCase()) || 0;
    seen.set(name.toLowerCase(), n + 1);
    if (n > 0) name = `${name} (${n + 1})`;
    return name;
  });
}

function cellText(v: unknown): string {
  if (v == null) return '';
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10);
  return String(v).trim();
}

function fromGrid(grid: unknown[][]): ParsedSheet {
  // The header is the first row with anything in it: exports often start
  // with a title line or a blank row.
  const start = grid.findIndex((r) => Array.isArray(r) && r.some((c) => cellText(c)));
  if (start < 0) return { headers: [], rows: [] };
  const headers = uniqueHeaders(grid[start]);
  const rows: Record<string, string>[] = [];
  for (const r of grid.slice(start + 1)) {
    if (!Array.isArray(r) || !r.some((c) => cellText(c))) continue;
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = cellText(r[i]); });
    rows.push(row);
  }
  return { headers, rows };
}

/** Text from a file or a paste. The delimiter is detected (comma, tab, semicolon). */
export function parseText(text: string): ParsedSheet {
  const result = Papa.parse<string[]>(text.replace(/^﻿/, ''), { skipEmptyLines: 'greedy' });
  if (result.errors.length > 0 && result.data.length === 0) {
    throw new Error(result.errors[0].message);
  }
  return fromGrid(result.data as unknown[][]);
}

export async function parseSpreadsheetFile(file: File): Promise<ParsedSheet> {
  if (EXCEL_RE.test(file.name)) {
    // Loaded only when someone actually drops a workbook.
    const { readSheet } = await import('read-excel-file/browser');
    const grid = await readSheet(file);
    return fromGrid(grid as unknown[][]);
  }
  return parseText(await file.text());
}

/** Save a sheet as an .xlsx file. Text stays text: nothing is run as a formula. */
export async function downloadXlsx(filename: string, header: readonly string[], rows: readonly (readonly CsvValue[])[]): Promise<void> {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  const data = [
    header.map((h) => ({ value: h, fontWeight: 'bold' as const })),
    ...rows.map((r) => r.map((v) => (v == null || v === '' ? null : { value: typeof v === 'number' || typeof v === 'boolean' ? v : String(v) }))),
  ];
  await writeXlsxFile(data as any, { columns: header.map((h) => ({ width: Math.min(40, Math.max(10, h.length + 4)) })) }).toFile(filename);
}
