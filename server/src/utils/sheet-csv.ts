/* Google Sheets links and their CSV, kept free of server config so the
   checks can test them without database credentials. */

import Papa from 'papaparse';

export const MAX_ROWS = 20_000;

/** The CSV export link for a Google Sheets link, or null if it is not one. */
export function sheetCsvUrl(raw: string): string | null {
  let u: URL;
  try { u = new URL(String(raw || '').trim()); } catch { return null; }
  if (u.protocol !== 'https:' || u.hostname !== 'docs.google.com') return null;
  // Published to the web: /spreadsheets/d/e/<pubid>/pub?output=csv
  const pub = u.pathname.match(/^\/spreadsheets\/d\/e\/([\w-]+)\/pub(?:html)?$/);
  if (pub) {
    const gid = u.searchParams.get('gid');
    return `https://docs.google.com/spreadsheets/d/e/${pub[1]}/pub?output=csv${gid && /^\d+$/.test(gid) ? `&gid=${gid}` : ''}`;
  }
  const m = u.pathname.match(/^\/spreadsheets\/d\/([\w-]{20,})/);
  if (!m) return null;
  const gid = u.searchParams.get('gid') || (u.hash.match(/gid=(\d+)/)?.[1] ?? null);
  return `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv${gid && /^\d+$/.test(gid) ? `&gid=${gid}` : ''}`;
}

function cell(v: unknown): string { return v == null ? '' : String(v).trim(); }

/** Same shape the import page parses a file into. */
export function parseSheetCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const grid = (Papa.parse<string[]>(text.replace(/^﻿/, ''), { skipEmptyLines: 'greedy' }).data || []) as unknown[][];
  const start = grid.findIndex((r) => Array.isArray(r) && r.some((c) => cell(c)));
  if (start < 0) return { headers: [], rows: [] };
  const seen = new Map<string, number>();
  const headers = (grid[start] as unknown[]).map((h, i) => {
    let name = cell(h) || `Column ${i + 1}`;
    const n = seen.get(name.toLowerCase()) || 0;
    seen.set(name.toLowerCase(), n + 1);
    if (n > 0) name = `${name} (${n + 1})`;
    return name;
  });
  const rows: Record<string, string>[] = [];
  for (const r of grid.slice(start + 1)) {
    if (!Array.isArray(r) || !r.some((c) => cell(c))) continue;
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = cell(r[i]); });
    rows.push(row);
    if (rows.length >= MAX_ROWS) break;
  }
  return { headers, rows };
}

