import { PageHeader } from '../../components/shared/PageHeader';
import { useState, useCallback, useEffect, useRef, useMemo, useSyncExternalStore } from 'react';
import { importRunner } from '../../lib/importRunner';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { contactsApi, listsApi, tagsApi, type BulkImportResult, type ImportPreflight } from '../../api/contacts.api';
import { importsApi } from '../../api/imports.api';
import { cn } from '../../lib/utils';
import {
  ArrowLeft, Upload, FileText, X, Check, AlertTriangle,
  ArrowRight, Users, Loader2, CheckCircle2, XCircle, Eye,
  FolderOpen, RotateCcw, Download, AlertCircle, MailCheck, Plus,
  SlidersHorizontal, ChevronDown, Sparkles, Send, ClipboardPaste, Search,
  Building2, User, Tag as TagIcon, Undo2, Bookmark, MailX, RefreshCw, History,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { blockedProps, BLOCKED_CLASS } from '../../lib/blockedAction';
import { downloadCsv, csvDate } from '../../lib/csv';
import { parseSpreadsheetFile, parseText, isSupportedFile, type ParsedSheet } from '../../lib/spreadsheet';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import {
  firstBlocker, planImport, prepareImport, mappingProblems, headerSignature,
  IMPORT_TARGET_LABELS, IMPORT_TARGET_GROUPS, COMPANY_TARGETS, type ImportTarget, type ImportMode,
} from '@lemlist/shared';

type Step = 'upload' | 'map' | 'importing' | 'complete';

interface ImportProgress {
  total: number;
  processed: number;
  imported: number;
  errors: number;
  errorDetails: { email: string; reason: string }[];
  currentBatch: number;
  totalBatches: number;
}

const BATCH_SIZE = 100;
const MAX_PREVIEW_ROWS = 5;

function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/* ---- saved mappings ----------------------------------------------------
   The same tool exports the same columns every time. Once a layout has
   been imported, the mapping used is remembered under its header
   signature and applied to the next file with that layout - so a
   correction is made once, not every Monday. Per browser, which is what a
   convenience like this should be. */
const TEMPLATE_KEY = 'sincerely.import.templates.v1';

function loadTemplate(sig: string): Record<string, string> | null {
  try {
    const all = JSON.parse(localStorage.getItem(TEMPLATE_KEY) || '{}');
    const t = all?.[sig];
    return t && typeof t === 'object' ? t : null;
  } catch {
    return null;
  }
}

function saveTemplate(sig: string, mapping: Record<string, string>) {
  try {
    const all = JSON.parse(localStorage.getItem(TEMPLATE_KEY) || '{}') || {};
    all[sig] = mapping;
    // Keep the twenty most recent layouts.
    const keys = Object.keys(all);
    for (const k of keys.slice(0, Math.max(0, keys.length - 20))) delete all[k];
    localStorage.setItem(TEMPLATE_KEY, JSON.stringify(all));
  } catch { /* private window: nothing remembered, nothing broken */ }
}

const MODE_OPTIONS: Array<{ id: ImportMode; label: string; hint: string }> = [
  { id: 'fill', label: 'Fill in blanks', hint: 'Keep what you have; only empty fields are filled from the file.' },
  { id: 'overwrite', label: 'Update with the file', hint: 'Values in the file replace what you have. Empty cells never erase anything.' },
  { id: 'skip', label: 'Leave them alone', hint: 'People already here are not changed at all (they still join the list).' },
];

/** Which group a target belongs to, for the review chips. */
function groupOf(t: string): 'person' | 'company' | 'custom' | 'skip' | 'other' {
  if (!t) return 'skip';
  if (t === '__custom__') return 'custom';
  if (t === 'company' || COMPANY_TARGETS.has(t as ImportTarget)) return 'company';
  if (t === 'tags' || t === 'email_status' || t === 'do_not_contact') return 'other';
  return 'person';
}

export function BulkImportPage() {
  const navigate = useNavigate();
  const confirm = useConfirm();
  /* Which page sent you: ?as=lead from Leads, ?as=contact from Contacts. */
  const [searchParams] = useSearchParams();
  const arrivedAs: 'prospect' | 'contact' = searchParams.get('as') === 'contact' ? 'contact' : 'prospect';
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>('upload');
  const [file, setFile] = useState<File | null>(null);
  /** Where the rows came from when there is no file: pasted text. */
  const [sourceName, setSourceName] = useState<string>('');
  const [parseError, setParseError] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [previewRows, setPreviewRows] = useState<Record<string, string>[]>([]);
  const [allRows, setAllRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  /** The planner's own answer, to go back to after a saved mapping. */
  const [autoMapping, setAutoMapping] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [usingTemplate, setUsingTemplate] = useState(false);
  /* Open when the planner was not sure of the email column - the one thing
     an import cannot guess wrong. Otherwise the table waits behind
     "Adjust columns"; the review card above it already says what went where. */
  const [showMapping, setShowMapping] = useState(false);
  const [skipFlagged, setSkipFlagged] = useState(true);
  const [mode, setMode] = useState<ImportMode>('fill');
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [newTag, setNewTag] = useState('');
  /** Keep people with no usable email in the list, as the "No email" light. */
  const [keepHeld, setKeepHeld] = useState(true);
  /** How many were kept that way, for the summary. */
  const [heldCount, setHeldCount] = useState(0);
  const [preflight, setPreflight] = useState<ImportPreflight | null>(null);
  const [targetListId, setTargetListId] = useState<string>('');
  const [listMode, setListMode] = useState<'none' | 'existing' | 'new'>('none');
  const [newListName, setNewListName] = useState('');
  /* A lead list is campaign audience; a contact list is people you already
     know, and importing into one files them as contacts, not prospects. */
  // Follows "Import as": leads go into lead lists, contacts into contact lists.
  // Where these people land. Prospects (the default) stay off the Contacts
  // tab until they reply; Contacts are people you already know. A contact
  // list files them as contacts whatever this says.
  const [importAs, setImportAsState] = useState<'prospect' | 'contact'>(arrivedAs);
  const newListKind: 'lead' | 'contact' = importAs === 'contact' ? 'contact' : 'lead';
  // A list of the other kind cannot be the target any more.
  const setImportAs = (v: 'prospect' | 'contact') => { setImportAsState(v); setTargetListId(''); };
  const [filedAs, setFiledAs] = useState<'prospect' | 'contact'>(arrivedAs);
  const pageWord = importAs === 'contact' ? 'contacts' : 'leads';
  /** Set once the import creates the list, so the summary can name it. */
  const [createdListName, setCreatedListName] = useState<string | null>(null);
  const [progress, setProgress] = useState<ImportProgress>({
    total: 0, processed: 0, imported: 0, errors: 0,
    errorDetails: [], currentBatch: 0, totalBatches: 0,
  });
  const [completedResult, setCompletedResult] = useState<{
    total: number; attempted: number; imported: number; errors: number;
    /** New addresses, existing ones that only had blanks filled, and how
     *  many are on the suppression list. */
    created: number; updated: number; suppressed: number;
    /** Ids of the contacts this import created, for undo. */
    createdIds: string[];
    errorDetails: { email: string; reason: string }[];
    durationMs: number;
    cancelled: boolean;
    importId?: string | null;
  } | null>(null);
  const [undone, setUndone] = useState(false);
  const [cancelRequested, setCancelRequested] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  /*
   * The import itself runs in importRunner, outside this page: leaving the
   * page no longer stops it. Coming back - to a running import or one that
   * finished while you were elsewhere - picks it up from there.
   */
  const run = useSyncExternalStore(importRunner.subscribe, importRunner.get, importRunner.get);
  useEffect(() => {
    if (!run) return;
    if (step !== 'upload' && step !== 'importing' && step !== 'complete') return;
    // A finished import already seen is not brought back on a fresh visit.
    if (run.status === 'done' && run.acknowledged && step === 'upload') return;
    setProgress(run.progress);
    setFiledAs(run.filedAs);
    setCreatedListName(run.createdListName);
    if (run.listId) setTargetListId(run.listId);
    if (!sourceName) setSourceName(run.label);
    if (run.status === 'running') {
      if (step !== 'importing') setStep('importing');
    } else if (run.result) {
      setCompletedResult(run.result);
      setHeldCount(run.heldCount);
      if (step !== 'complete') setStep('complete');
      importRunner.acknowledge();
    }
  }, [run]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: lists } = useQuery({
    queryKey: ['lists', 'all'],
    // Both kinds: importing a CSV of existing customers into a contact
    // list is as legitimate as importing a cold list into a lead list.
    queryFn: () => listsApi.list(),
  });
  const kindLists = useMemo(
    () => ((lists || []) as any[]).filter((l) => (l.kind === 'contact' ? 'contact' : 'lead') === newListKind),
    [lists, newListKind],
  );
  const { data: allTags } = useQuery({ queryKey: ['tags'], queryFn: () => tagsApi.list() });

  /** One way in for files and pastes alike. */
  const loadSheet = useCallback((sheet: ParsedSheet, name: string) => {
    const rows = sheet.rows.filter((r) => r && Object.values(r).some((v) => v && String(v).trim()));
    if (sheet.headers.length === 0) {
      setParseError('Could not find any columns. Make sure the first row holds the column names.');
      return;
    }
    if (rows.length === 0) {
      setParseError('There are column names but no rows of people under them.');
      return;
    }
    if (rows.length > 50_000) {
      setParseError(`This has ${rows.length.toLocaleString()} rows; the most one import takes is 50,000. Split it into smaller files.`);
      return;
    }
    // Headers and values both, so a column called "Col 3" that is full
    // of addresses is still found as the email.
    const plan = planImport(sheet.headers, rows);
    const sig = headerSignature(sheet.headers);
    const saved = loadTemplate(sig);
    let initial: Record<string, string> = plan.mapping;
    if (saved && sheet.headers.every((h) => h in saved) && mappingProblems(saved).length === 0) {
      initial = Object.fromEntries(sheet.headers.map((h) => [h, saved[h]]));
      setUsingTemplate(true);
    } else {
      setUsingTemplate(false);
    }

    setSourceName(name);
    setHeaders(sheet.headers);
    setPreviewRows(rows.slice(0, MAX_PREVIEW_ROWS));
    setAllRows(rows);
    setAutoMapping(plan.mapping);
    setNotes(plan.notes);
    setMapping(initial);
    setShowMapping(!plan.confident && mappingProblems(initial).length > 0);
    setPreflight(null);
    setStep('map');
  }, []);

  // Parse the file the moment it is chosen: CSV, TSV, TXT or Excel.
  const handleFile = useCallback(async (f: File) => {
    setParseError(null);
    setFile(f);
    if (!isSupportedFile(f.name)) {
      setParseError('Upload a .csv, .tsv, .txt or Excel (.xlsx) file. From Google Sheets: File > Download > CSV.');
      return;
    }
    if (f.size > 50 * 1024 * 1024) {
      setParseError('File too large — maximum 50 MB.');
      return;
    }
    setParsing(true);
    try {
      loadSheet(await parseSpreadsheetFile(f), f.name);
    } catch (err: any) {
      setParseError(`Could not read this file: ${err?.message || 'unknown error'}`);
    } finally {
      setParsing(false);
    }
  }, [loadSheet]);

  const handlePaste = () => {
    setParseError(null);
    setFile(null);
    try {
      loadSheet(parseText(pasteText), `Pasted ${csvDate()}`);
    } catch (err: any) {
      setParseError(`Could not read what was pasted: ${err?.message || 'unknown error'}`);
    }
  };

  const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
    e.target.value = '';
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  };

  // Validation for the mapping step. Multiple columns may map to a custom
  // field, so only standard targets are checked for duplicates.
  const mappedFields = Object.values(mapping).filter(Boolean);
  const problems = mappingProblems(mapping);
  const hasEmail = mappedFields.includes('email');
  const mappingValid = problems.length === 0;
  const emailColumn = useMemo(() => Object.keys(mapping).find((h) => mapping[h] === 'email') ?? null, [mapping]);

  const effectiveRows = allRows;

  /* The rows exactly as they will be sent: cleaned, deduplicated, and with
     anything that cannot be imported set aside. The counts on the page and
     the import itself read this one result, so they cannot disagree. */
  const prepared = useMemo(
    () => (mappingValid ? prepareImport(effectiveRows, mapping, { skipFlagged }) : null),
    [effectiveRows, mapping, mappingValid, skipFlagged],
  );
  const importableCount = prepared?.contacts.length ?? 0;

  /** A row's value for a target, through the mapping. */
  const valueFor = useCallback((row: Record<string, string>, target: string) => {
    const col = Object.keys(mapping).find((h) => mapping[h] === target);
    return col ? String(row[col] ?? '').trim() : '';
  }, [mapping]);

  /* People with no usable email who can still be kept: anyone with a
     name or a LinkedIn profile to recognise them by later. */
  const holdable = useMemo(() => (prepared?.setAside || []).filter((s) =>
    (s.reason === 'no_email' || s.reason === 'invalid_email')
    && !!(valueFor(s.row, 'linkedin_url') || valueFor(s.row, 'first_name') || valueFor(s.row, 'last_name') || valueFor(s.row, 'full_name'))),
  [prepared, valueFor]);

  // Before the import: how many are already here, and suppressed.
  const preparedEmails = useMemo(() => (prepared?.contacts || []).map((c) => c.email), [prepared]);
  useEffect(() => {
    if (step !== 'map' || preparedEmails.length === 0) { setPreflight(null); return; }
    let live = true;
    const t = setTimeout(async () => {
      try {
        let existing = 0;
        let suppressed = 0;
        for (let i = 0; i < preparedEmails.length; i += 10_000) {
          const r = await contactsApi.importPreflight(preparedEmails.slice(i, i + 10_000));
          existing += r.existing;
          suppressed += r.suppressed;
        }
        if (live) setPreflight({ existing, suppressed, checked: preparedEmails.length });
      } catch {
        if (live) setPreflight(null); // a nice-to-have; the import does not depend on it
      }
    }, 400);
    return () => { live = false; clearTimeout(t); };
  }, [preparedEmails, step]);

  // Everything that will not be imported, whole, with why - to fix and re-upload.
  const downloadSetAside = () => {
    const rows = prepared?.setAside || [];
    if (rows.length === 0) return;
    downloadCsv(
      `not-imported-${csvDate()}.csv`,
      [...headers, 'Why it was not imported'],
      rows.map((s) => [...headers.map((h) => s.row[h] ?? ''), s.detail]),
    );
  };

  /** What went where, grouped, for the review card. */
  const review = useMemo(() => {
    const g = { person: [] as string[], company: [] as string[], other: [] as string[], custom: [] as string[], skip: [] as string[] };
    for (const h of headers) g[groupOf(mapping[h] || '')].push(h);
    return g;
  }, [headers, mapping]);

  /** Default name for a new list: the CSV's own filename, tidied up. */
  const suggestedListName = useMemo(() => {
    const base = (sourceName || '').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
    if (!base) return '';
    return base.charAt(0).toUpperCase() + base.slice(1);
  }, [sourceName]);

  const duplicateListName = useMemo(() => {
    const name = newListName.trim().toLowerCase();
    if (!name) return false;
    return (lists || []).some((l) => l.name.trim().toLowerCase() === name);
  }, [newListName, lists]);

  const listChoiceValid =
    listMode === 'none' ||
    (listMode === 'existing' && !!targetListId) ||
    (listMode === 'new' && !!newListName.trim() && !duplicateListName);

  const addNewTag = async () => {
    const name = newTag.trim();
    if (!name) return;
    const existing = (allTags || []).find((t) => t.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      setTagIds((prev) => (prev.includes(existing.id) ? prev : [...prev, existing.id]));
      setNewTag('');
      return;
    }
    try {
      const created = await tagsApi.create({ name });
      queryClient.invalidateQueries({ queryKey: ['tags'] });
      setTagIds((prev) => [...prev, created.id]);
      setNewTag('');
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Could not create that tag');
    }
  };

  // Kick off the import
  const startImport = useCallback(async () => {
    if (!mappingValid || !listChoiceValid || !prepared) return;
    if (importRunner.isRunning()) { toast.error('An import is already running - it shows in the corner.'); return; }
    setCancelRequested(false);
    setUndone(false);
    // Remembered for the next file with these columns.
    if (headers.length) saveTemplate(headerSignature(headers), mapping);

    // Create the list first — if this fails there's nothing to undo yet, which
    // is much kinder than importing thousands of contacts into nowhere.
    let listId = listMode === 'existing' ? targetListId : '';
    if (listMode === 'new') {
      try {
        const created = await listsApi.create({ name: newListName.trim(), kind: newListKind });
        listId = created.id;
        setTargetListId(created.id);
        setCreatedListName(created.name);
        queryClient.invalidateQueries({ queryKey: ['lists'] });
      } catch (err: any) {
        toast.error(err.response?.data?.error || 'Could not create the list — nothing was imported.');
        return;
      }
    }

    const startedAt = Date.now();

    const mapped = prepared.contacts;

    const total = mapped.length;
    const totalBatches = Math.ceil(total / BATCH_SIZE);
    const chosenListEarly = listMode === 'existing' ? (lists || []).find((l: any) => l.id === targetListId) : null;
    const runId = importRunner.start({
      label: sourceName || 'Import',
      filedAs: (importAs === 'contact' || (listMode === 'new' && newListKind === 'contact') || (chosenListEarly as any)?.kind === 'contact') ? 'contact' : 'prospect',
      listId: listId || null,
      createdListName: listMode === 'new' ? newListName.trim() : null,
      total,
      totalBatches,
    });
    setStep('importing');

    // Recorded in Import history, so it can be undone from there later.
    const importId = await importsApi.start({
      source: sourceName || 'Import',
      origin: /^Pasted /.test(sourceName) && !file ? 'paste' : 'file',
      list_id: listId || null,
      kind: (importAs === 'contact' || (listMode === 'new' && newListKind === 'contact') || (chosenListEarly as any)?.kind === 'contact') ? 'contact' : 'lead',
      total,
    });

    // A file of nobody with an email still runs: the loop below does
    // nothing and the people are held.
    let imported = 0;
    let errors = 0;
    let createdCount = 0;
    let updatedCount = 0;
    let suppressedCount = 0;
    let attempted = 0;
    let cancelled = false;
    const createdIds: string[] = [];
    const errorDetails: { email: string; reason: string }[] = [];
    const chosenList = listMode === 'existing' ? (lists || []).find((l: any) => l.id === targetListId) : null;
    const asContacts = importAs === 'contact'
      || (listMode === 'new' && newListKind === 'contact')
      || (chosenList as any)?.kind === 'contact';
    setFiledAs(asContacts ? 'contact' : 'prospect');

    for (let i = 0; i < total; i += BATCH_SIZE) {
      if (importRunner.cancelRequested()) { cancelled = true; break; }
      const batch = mapped.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      try {
        // The filename travels with every batch so each contact remembers
        // which import it arrived in.
        const result: BulkImportResult = await contactsApi.bulkCreate(
          batch, listId || undefined, sourceName || undefined, asContacts ? 'contacts' : undefined, { mode, tagIds, importId },
        );
        imported += result.imported;
        errors += result.errors;
        createdCount += result.created ?? 0;
        updatedCount += result.updated ?? 0;
        suppressedCount += result.suppressed ?? 0;
        if (result.created_ids) createdIds.push(...result.created_ids);
        if (result.error_details && errorDetails.length < 200) {
          errorDetails.push(...result.error_details.slice(0, 200 - errorDetails.length));
        }
      } catch (err: any) {
        errors += batch.length;
        const msg = err.response?.data?.error || err.message || 'Network error';
        if (errorDetails.length < 200) {
          for (const c of batch.slice(0, 5)) {
            if (errorDetails.length >= 200) break;
            errorDetails.push({ email: c.email || '(unknown)', reason: msg });
          }
        }
      }
      attempted = Math.min(i + BATCH_SIZE, total);
      importRunner.progress(runId, {
        total,
        processed: attempted,
        imported, errors, errorDetails,
        currentBatch: batchNum,
        totalBatches,
      });
      // Yield to UI between batches so the progress bar can paint
      await new Promise((r) => setTimeout(r, 0));
    }

    // People with no usable email: held in the same list as "No email".
    let held = 0;
    if (!cancelled && keepHeld && holdable.length > 0 && emailColumn) {
      const people = holdable.map((sa) => {
        // The row's fields in the shape a contact takes, via the same
        // cleaner - with a stand-in address, dropped again below.
        const c: Record<string, any> = prepareImport([{ ...sa.row, [emailColumn]: 'held@example.invalid' }], mapping, { skipFlagged: false }).contacts[0] || {};
        const { email: _e, first_name, last_name, company, job_title, linkedin_url, ...rest } = c;
        return {
          first_name, last_name, company, job_title, linkedin_url,
          raw_email: String(sa.row[emailColumn] ?? '').trim() || undefined,
          reason: sa.reason === 'invalid_email' ? 'invalid_email' : 'no_email',
          data: rest,
        };
      });
      try {
        for (let i = 0; i < people.length; i += 1000) {
          const r = await contactsApi.holdPeople(people.slice(i, i + 1000), listId || undefined, sourceName || undefined, asContacts ? 'contact' : 'lead');
          if (r.unavailable) { toast.error('People without an email could not be kept yet - they are in the "not imported" download.'); break; }
          held += r.held;
        }
      } catch (err: any) {
        toast.error(err?.response?.data?.error || 'People without an email could not be kept - they are in the "not imported" download.');
      }
    }
    importRunner.held(runId, held);
    if (importId) await importsApi.finish(importId, { held, cancelled });

    importRunner.finish(runId, {
      total,
      attempted,
      imported,
      errors,
      created: createdCount,
      updated: updatedCount,
      suppressed: suppressedCount,
      createdIds,
      errorDetails,
      durationMs: Date.now() - startedAt,
      cancelled,
      importId,
    });
    queryClient.invalidateQueries({ queryKey: ['lists'] });
    for (const key of ['contacts', 'contact-stats', 'contact-companies', 'verification-breakdown', 'companies', 'tags']) {
      queryClient.invalidateQueries({ queryKey: [key] });
    }
  }, [prepared, mappingValid, listChoiceValid, listMode, targetListId, newListName, newListKind, importAs, lists, queryClient, sourceName, mode, tagIds, headers, mapping, keepHeld, holdable, emailColumn, file]);

  const cancel = () => {
    importRunner.cancel();
    setCancelRequested(true);
    toast('Cancelling after current batch…', { icon: '⏸' });
  };

  /** Take back the people this import added. Existing people are not touched. */
  const undoImport = () => {
    const ids = completedResult?.createdIds || [];
    if (ids.length === 0) return;
    confirm({
      title: `Remove the ${ids.length.toLocaleString()} ${ids.length === 1 ? 'person' : 'people'} this import added?`,
      body: completedResult && completedResult.updated > 0
        ? `They are deleted. The ${completedResult.updated.toLocaleString()} who were already here stay, and any fields this import filled on them are kept.`
        : 'They are deleted, along with their list memberships and tags.',
      confirmLabel: 'Undo import',
      tone: 'danger',
    }, async () => {
      try {
        let deleted = 0;
        if (completedResult?.importId) {
          // Through Import history, so the run shows as undone there too.
          const r = await importsApi.undo(completedResult.importId);
          deleted = r.deleted;
          if (r.kept_in_campaigns) toast(`${r.kept_in_campaigns.toLocaleString()} already in a campaign were kept`, { duration: 6000 });
        } else {
          for (let i = 0; i < ids.length; i += 1000) {
            deleted += (await contactsApi.bulkDelete(ids.slice(i, i + 1000))).deleted;
          }
        }
        setUndone(true);
        for (const key of ['contacts', 'contact-stats', 'lists', 'contact-companies', 'verification-breakdown']) {
          queryClient.invalidateQueries({ queryKey: [key] });
        }
        toast.success(`Removed ${deleted.toLocaleString()} ${deleted === 1 ? 'person' : 'people'}`);
      } catch (err: any) {
        toast.error(err?.response?.data?.error || 'Could not undo the import');
      }
    });
  };

  // Reset to start over
  const reset = () => {
    importRunner.clear();
    setCancelRequested(false);
    setFile(null);
    setSourceName('');
    setParseError(null);
    setHeaders([]);
    setPreviewRows([]);
    setAllRows([]);
    setMapping({});
    setAutoMapping({});
    setNotes({});
    setUsingTemplate(false);
    setShowMapping(false);
    setPreflight(null);
    setHeldCount(0);
    setTargetListId('');
    setListMode('none');
    setNewListName('');
    setPasteText('');
    setPasteOpen(false);
    setUndone(false);

    setCreatedListName(null);
    setCompletedResult(null);
    setProgress({ total: 0, processed: 0, imported: 0, errors: 0, errorDetails: [], currentBatch: 0, totalBatches: 0 });
    setStep('upload');
  };

  // Download error log as CSV
  const downloadErrors = () => {
    const details = completedResult?.errorDetails || [];
    if (details.length === 0) return;
    downloadCsv(`import-errors-${csvDate()}.csv`, ['email', 'reason'], details.map((e) => [e.email || '', e.reason || '']));
  };

  // Steps strip
  const stepConfig: { id: Step; label: string; icon: any }[] = [
    { id: 'upload',    label: 'Upload',    icon: Upload     },
    { id: 'map',       label: 'Review',    icon: ArrowRight },
    { id: 'importing', label: 'Import',    icon: Loader2    },
    { id: 'complete',  label: 'Done',      icon: CheckCircle2 },
  ];
  const currentStepIdx = stepConfig.findIndex((s) => s.id === step);
  const setAsideCount = prepared?.setAside.length ?? 0;
  const existingCount = preflight?.existing ?? null;

  /** One chip in the review card: column -> where it goes. */
  const Chip = ({ h }: { h: string }) => {
    const t = mapping[h] || '';
    const label = t ? IMPORT_TARGET_LABELS[t as ImportTarget]?.replace(/ \(.*\)$/, '') : 'Skipped';
    const same = label.toLowerCase() === h.toLowerCase();
    return (
      <span title={notes[h] || undefined} className="inline-flex items-center gap-1 max-w-full px-2 h-6 rounded-md bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-caption text-[var(--text-secondary)]">
        <span className="truncate font-medium text-[var(--text-primary)]">{h}</span>
        {!same && t && t !== '__custom__' && (<><ArrowRight className="h-2.5 w-2.5 flex-shrink-0 text-[var(--text-tertiary)]" /><span className="truncate">{label}</span></>)}
      </span>
    );
  };

  return (
    <>
      <PageHeader
        icon={Upload}
        // No way back mid-import: leaving would orphan the batches in flight.
        breadcrumbs={step === 'importing' ? undefined : [
          importAs === 'contact' ? { label: 'Contacts', href: '/contacts' } : { label: 'Leads', href: '/leads' },
          { label: 'Import' },
        ]}
        title={importAs === 'contact' ? 'Import contacts' : 'Import leads'}
        description={
          step === 'upload' ? `Upload a CSV or Excel file of your ${pageWord}, or paste from a spreadsheet - columns are matched for you.`
            : step === 'map'
              ? (showMapping ? 'Tell us which column is which, then start the import.' : 'Everything is matched up. Check the numbers and start the import.')
              : step === 'importing' ? `Your ${pageWord} are being added in batches.`
                : 'All done. Here is what happened.'
        }
        contentClassName="max-w-4xl"
        actions={
        <div className="flex items-center gap-1.5">
          {stepConfig.map((s, i) => {
            const Icon = s.icon;
            const done = i < currentStepIdx;
            const current = i === currentStepIdx;
            return (
              <div key={s.id} className="flex items-center gap-1.5">
                <span
                  className={cn(
                    'flex h-6 w-6 items-center justify-center rounded-full transition-all',
                    done && 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
                    current && 'bg-[var(--indigo)] text-white shadow-[var(--glow-indigo)]',
                    !done && !current && 'bg-[var(--bg-elevated)] text-[var(--text-tertiary)]'
                  )}
                >
                  {done ? (
                    <Check className="h-3 w-3" strokeWidth={3} />
                  ) : (
                    <Icon className={cn('h-3 w-3', current && s.id === 'importing' && 'animate-spin')} />
                  )}
                </span>
                <span className={cn(
                  'text-caption font-semibold transition-colors hidden sm:inline',
                  current ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]'
                )}>
                  {s.label}
                </span>
                {i < stepConfig.length - 1 && (
                  <div className={cn(
                    'h-px w-6 transition-colors',
                    i < currentStepIdx ? 'bg-emerald-500/40' : 'bg-[var(--border-subtle)]'
                  )} />
                )}
              </div>
            );
          })}
        </div>
        }
      />
    <div className="space-y-5 max-w-4xl">
      {/* ════════════════════════════════════════════════════════ */}
      {/* STEP 1 — Upload                                          */}
      {/* ════════════════════════════════════════════════════════ */}
      {step === 'upload' && (
        <div className="space-y-3">
          <label
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={onDrop}
            className={cn(
              'relative flex flex-col items-center justify-center min-h-[260px] rounded-2xl border-2 border-dashed cursor-pointer transition-all p-8 text-center',
              isDragging
                ? 'border-[var(--indigo)] bg-[var(--indigo)]/5 scale-[1.005]'
                : 'border-[var(--border-default)] bg-[var(--bg-surface)] hover:border-[var(--indigo)]/40 hover:bg-[var(--bg-hover)]'
            )}
          >
            <input
              type="file"
              accept=".csv,.tsv,.txt,.xlsx,.xlsm,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={onFileInput}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              aria-label="Choose a CSV or Excel file"
            />
            <span className={cn(
              'flex h-14 w-14 items-center justify-center rounded-2xl mb-4 transition-all',
              isDragging
                ? 'bg-[var(--indigo)] text-white scale-110'
                : 'bg-[var(--indigo)]/10 text-[var(--indigo-text)]'
            )}>
              {parsing ? <Loader2 className="h-6 w-6 animate-spin" /> : <Upload className="h-6 w-6" strokeWidth={1.5} />}
            </span>
            <p className="text-heading font-semibold text-[var(--text-primary)] mb-1">
              {parsing ? 'Reading your file...' : isDragging ? 'Drop it here' : 'Drop a CSV or Excel file here, or click to browse'}
            </p>
            <p className="text-body text-[var(--text-secondary)]">
              .csv, .tsv, .txt or .xlsx, up to 50 MB and 50,000 rows
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-1.5" aria-label="Exports recognised automatically">
              {['Apollo', 'Lemlist', 'HubSpot', 'Sales Navigator', 'ZoomInfo', 'Hunter', 'Google Sheets', 'Excel'].map((t) => (
                <span key={t} className="px-2 h-6 inline-flex items-center rounded-full bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-caption text-[var(--text-secondary)]">{t}</span>
              ))}
            </div>
          </label>

          {/* Paste: for the list that lives in a Google Sheet. */}
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
            <button
              type="button"
              onClick={() => setPasteOpen((v) => !v)}
              aria-expanded={pasteOpen}
              className="w-full flex items-center gap-2 px-4 py-3 text-left text-body font-medium text-[var(--text-primary)]"
            >
              <ClipboardPaste className="h-4 w-4 text-[var(--indigo-text)]" />
              Paste from a spreadsheet instead
              <ChevronDown className={cn('h-3.5 w-3.5 ml-auto text-[var(--text-tertiary)] transition-transform', pasteOpen && 'rotate-180')} />
            </button>
            {pasteOpen && (
              <div className="px-4 pb-4 space-y-2">
                <p className="text-caption text-[var(--text-tertiary)]">Select the cells in Google Sheets or Excel - including the header row - copy, and paste them here.</p>
                <textarea
                  aria-label="Pasted rows"
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  rows={6}
                  placeholder={'Email\tFirst name\tCompany\nada@analytical.io\tAda\tAnalytical'}
                  className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-2.5 font-mono text-caption text-[var(--text-primary)] outline-none focus:border-[var(--indigo)] focus:ring-2 focus:ring-[var(--indigo)]/15"
                />
                <div className="flex justify-end">
                  <button type="button" onClick={handlePaste} disabled={!pasteText.trim()} className="btn-primary">
                    <ArrowRight className="h-3.5 w-3.5" />
                    Use these rows
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* A sheet the team keeps adding to: synced on a schedule instead. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-3" data-sheet-sync-entry>
            <RefreshCw className="h-4 w-4 text-[var(--indigo-text)] flex-shrink-0" />
            <span className="flex-1 min-w-[220px]">
              <span className="block text-body font-medium text-[var(--text-primary)]">Keep a Google Sheet in sync</span>
              <span className="block text-caption text-[var(--text-tertiary)]">New rows come in by themselves, every few hours, with this mapping saved.</span>
            </span>
            <button type="button" onClick={() => navigate(`/contacts/imports?sheet=new&as=${importAs}`)} className="btn-secondary">Connect a sheet</button>
            <button type="button" onClick={() => navigate('/contacts/imports')} className="btn-ghost">
              <History className="h-3.5 w-3.5" /> Import history
            </button>
          </div>

          {parseError && (
            <div className="flex items-start gap-2.5 px-3.5 py-2.5 rounded-lg bg-rose-500/10 border border-rose-500/25">
              <AlertCircle className="h-4 w-4 text-rose-500 flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-body font-semibold text-rose-700 dark:text-rose-400">Couldn't read this file</p>
                <p className="text-caption text-rose-600 dark:text-rose-400 mt-0.5">{parseError}</p>
              </div>
              <button aria-label="Remove file" onClick={() => { setFile(null); setParseError(null); }} className="p-1 rounded hover:bg-rose-500/10">
                <X className="h-3 w-3 text-rose-500" />
              </button>
            </div>
          )}

          {/* What happens, so nobody tidies a file by hand first. */}
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
            <p className="text-caption font-bold text-[var(--text-tertiary)] mb-2.5">
              No need to tidy the file first
            </p>
            <ul className="space-y-1.5 text-body text-[var(--text-secondary)]">
              <li className="flex items-start gap-2">
                <Check className="h-3.5 w-3.5 text-emerald-500 mt-0.5 flex-shrink-0" />
                <span>Columns are matched by name and by what is in them - person, company, LinkedIn, location, tags.</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="h-3.5 w-3.5 text-emerald-500 mt-0.5 flex-shrink-0" />
                <span>Anything unrecognised is kept as a custom field, never dropped. Repeated and bookkeeping columns are skipped.</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="h-3.5 w-3.5 text-emerald-500 mt-0.5 flex-shrink-0" />
                <span>People without an email can be searched for, and anyone left out comes back as a file you can fix and re-upload.</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="h-3.5 w-3.5 text-emerald-500 mt-0.5 flex-shrink-0" />
                <span>People already here are matched by email - you choose whether the file fills blanks, updates them, or leaves them alone.</span>
              </li>
            </ul>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════ */}
      {/* STEP 2 — Review                                          */}
      {/* ════════════════════════════════════════════════════════ */}
      {step === 'map' && (
        <div className="space-y-4">
          {/* File info bar */}
          <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--indigo)]/10 text-[var(--indigo-text)] flex-shrink-0">
              <FileText className="h-4 w-4" />
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-strong font-semibold text-[var(--text-primary)] truncate">{sourceName}</p>
              <p className="text-caption text-[var(--text-tertiary)]">
                {file ? `${bytes(file.size)} · ` : ''}{allRows.length.toLocaleString()} rows · {headers.length} columns
              </p>
            </div>
            <button onClick={reset} className="icon-btn flex-shrink-0" title="Pick a different file" aria-label="Pick a different file">
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          </div>

          {usingTemplate && (
            <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg border border-[var(--indigo)]/25 bg-[var(--indigo-subtle)]" data-import-template>
              <Bookmark className="h-4 w-4 text-[var(--indigo-text)] flex-shrink-0" />
              <p className="flex-1 text-body text-[var(--text-primary)]">Using the column choices from the last time you imported a file like this.</p>
              <button
                type="button"
                onClick={() => { setMapping(autoMapping); setUsingTemplate(false); }}
                className="text-caption font-semibold text-[var(--indigo-text)] hover:underline flex-shrink-0"
              >
                Match automatically instead
              </button>
            </div>
          )}

          {/* What will happen, in one card. For most files this is the whole
              review: the columns were matched, the rows were cleaned, and
              the only question left is whether to go. */}
          {mappingValid && prepared && (
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4" data-import-summary>
              <div className="flex items-start gap-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex-shrink-0">
                  <Sparkles className="h-4 w-4" />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-body font-semibold text-[var(--text-primary)]">
                    {importableCount.toLocaleString()} {importableCount === 1 ? 'person' : 'people'} ready to import
                  </p>
                  {/* The four numbers that decide whether to go, at a glance. */}
                  <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2" data-import-preflight>
                    {([
                      { label: 'Ready', value: importableCount, tone: 'text-[var(--indigo-text)]', hint: 'Will be imported' },
                      { label: 'New', value: preflight ? Math.max(0, importableCount - (existingCount || 0)) : null, tone: 'text-emerald-600 dark:text-emerald-400', hint: 'Not in Sincerely yet' },
                      { label: 'Already here', value: preflight ? existingCount || 0 : null, tone: 'text-[var(--text-primary)]', hint: MODE_OPTIONS.find((m) => m.id === mode)!.label },
                      { label: 'Not importing', value: setAsideCount, tone: setAsideCount ? 'text-amber-600 dark:text-amber-400' : 'text-[var(--text-tertiary)]', hint: setAsideCount ? 'Download below' : 'Nothing left out' },
                    ]).map((t) => (
                      <div key={t.label} className="rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-subtle)] px-3 py-2">
                        <p className="text-micro font-bold text-[var(--text-tertiary)]">{t.label}</p>
                        <p className={cn('text-title font-semibold tabular leading-tight', t.tone)}>
                          {t.value == null ? <Loader2 className="h-4 w-4 animate-spin text-[var(--text-tertiary)] my-1" /> : t.value.toLocaleString()}
                        </p>
                        <p className="hidden sm:block text-caption text-[var(--text-tertiary)] truncate">{t.hint}</p>
                      </div>
                    ))}
                  </div>
                  {!!preflight?.suppressed && (
                    <p className="text-caption text-amber-700 dark:text-amber-400 mt-2">
                      {preflight.suppressed.toLocaleString()} {preflight.suppressed === 1 ? 'is' : 'are'} on your suppression list - imported, but never emailed.
                    </p>
                  )}
                  {(prepared.duplicates > 0 || prepared.invalid > 0 || prepared.blank > 0 || prepared.flaggedTotal > 0) && (
                    <ul className="mt-2.5 space-y-1 text-caption text-[var(--text-secondary)]">
                      {prepared.duplicates > 0 && (
                        <li className="flex items-center gap-1.5">
                          <Check className="h-3 w-3 text-emerald-500" strokeWidth={3} />
                          {prepared.duplicates.toLocaleString()} repeated {prepared.duplicates === 1 ? 'row' : 'rows'} merged into one contact each
                        </li>
                      )}
                      {prepared.invalid > 0 && (
                        <li className="flex items-center gap-1.5">
                          <AlertTriangle className="h-3 w-3 text-amber-500" />
                          {prepared.invalid.toLocaleString()} not an email address, left out
                          {prepared.invalidSamples.length > 0 && (
                            <span className="text-[var(--text-tertiary)] truncate">
                              {' '}({prepared.invalidSamples.map((v) => `"${v}"`).join(', ')})
                            </span>
                          )}
                        </li>
                      )}
                      {prepared.blank > 0 && (
                        <li className="flex items-center gap-1.5">
                          <AlertTriangle className="h-3 w-3 text-amber-500" />
                          {prepared.blank.toLocaleString()} with no email{holdable.length > 0 && keepHeld ? ' - kept in the list as No email (see below)' : ', left out'}
                        </li>
                      )}
                      {prepared.flaggedTotal > 0 && (
                        <li className="flex items-center gap-1.5">
                          <AlertTriangle className="h-3 w-3 text-amber-500" />
                          <label className="inline-flex items-center gap-1.5 cursor-pointer">
                            <input type="checkbox" checked={skipFlagged} onChange={(e) => setSkipFlagged(e.target.checked)} className="accent-[var(--indigo)]" />
                            Leave out the {prepared.flaggedTotal.toLocaleString()} your old tool marked invalid, unsubscribed or bounced
                          </label>
                        </li>
                      )}
                    </ul>
                  )}
                  {setAsideCount > 0 && (
                    <button type="button" onClick={downloadSetAside} className="mt-2.5 inline-flex items-center gap-1.5 text-caption font-semibold text-[var(--indigo-text)] hover:underline" data-download-set-aside>
                      <Download className="h-3 w-3" />
                      Download the {setAsideCount.toLocaleString()} {setAsideCount === 1 ? 'row' : 'rows'} not being imported, with the reason for each
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setShowMapping((v) => !v)}
                  aria-expanded={showMapping}
                  className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-body font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] flex-shrink-0"
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Adjust columns</span>
                  <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', showMapping && 'rotate-180')} />
                </button>
              </div>

              {/* What went where, in plain groups: a wrong guess shows here
                  without opening the table. */}
              <div className="mt-4 grid gap-3 sm:grid-cols-2" data-import-review>
                {([
                  ['person', 'Person', User],
                  ['company', 'Company', Building2],
                  ['other', 'Tags and flags', TagIcon],
                  ['custom', 'Kept as custom fields', Bookmark],
                  ['skip', 'Skipped', X],
                ] as const).filter(([k]) => review[k].length > 0).map(([k, title, Icon]) => (
                  <div key={k} className="min-w-0">
                    <p className="text-micro font-bold text-[var(--text-tertiary)] mb-1.5 flex items-center gap-1">
                      <Icon className="h-3 w-3" />
                      {title} <span className="font-normal">({review[k].length})</span>
                    </p>
                    {k === 'skip' ? (
                      <ul className="space-y-0.5">
                        {review.skip.map((h) => (
                          <li key={h} className="text-caption text-[var(--text-secondary)] truncate">
                            <span className="font-medium text-[var(--text-primary)]">{h}</span>
                            {notes[h] && mapping[h] === autoMapping[h] ? <span className="text-[var(--text-tertiary)]"> - {notes[h]}</span> : null}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {review[k].map((h) => <Chip key={h} h={h} />)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* People with no usable email: kept in the list, not dropped. */}
          {mappingValid && holdable.length > 0 && (
            <label className={cn('card flex items-start gap-3 p-4 cursor-pointer transition-colors', keepHeld ? 'border-[var(--border-default)]' : 'opacity-80')} data-import-hold>
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--bg-elevated)] text-[var(--text-secondary)] flex-shrink-0">
                <MailX className="h-4 w-4" />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-body font-semibold text-[var(--text-primary)]">
                  Keep {holdable.length.toLocaleString()} {holdable.length === 1 ? 'person' : 'people'} who {holdable.length === 1 ? 'has' : 'have'} no email
                </span>
                <span className="block text-caption text-[var(--text-tertiary)] mt-0.5">
                  They wait in the list under <span className="font-medium text-[var(--text-secondary)]">Missing an email</span> and are never emailed. Add an address later, or re-import the file once you have them.
                </span>
              </span>
              <span className="relative inline-flex items-center flex-shrink-0 mt-0.5">
                <input type="checkbox" checked={keepHeld} onChange={(e) => setKeepHeld(e.target.checked)} className="peer sr-only" aria-label="Keep people without an email" />
                <span className="h-5 w-9 rounded-full bg-[var(--border-strong)] transition-colors peer-checked:bg-[var(--indigo)] peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--indigo)]/30" />
                <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4" />
              </span>
            </label>
          )}

          {/* Field mapping */}
          {showMapping && (
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-hidden">
            <div className="px-4 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)] flex items-center justify-between">
              <div>
                <p className="text-body font-semibold text-[var(--text-primary)]">Column mapping</p>
                <p className="text-caption text-[var(--text-tertiary)]">Match your columns to person or company fields. Skip any you don't need.</p>
              </div>
              <div className="flex items-center gap-1.5 text-caption text-[var(--text-tertiary)]">
                <Eye className="h-3 w-3" />
                Preview shows first {previewRows.length} rows
              </div>
            </div>
            <div className="divide-y divide-[var(--border-subtle)]">
              {headers.map((h, i) => {
                const samples = previewRows
                  .map((r) => r[h])
                  .filter((v) => v && String(v).trim())
                  .slice(0, 3);
                const isDuplicate = !!mapping[h] && mapping[h] !== '__custom__' && mapping[h] !== 'do_not_contact'
                  && mappedFields.filter((f) => f === mapping[h]).length > 1;
                const isEmail = mapping[h] === 'email';
                return (
                  <div key={`${h}-${i}`} className="grid grid-cols-[1fr,auto,1fr] gap-3 items-center px-4 py-2.5">
                    <div className="min-w-0">
                      <p className="text-body font-mono font-semibold text-[var(--text-primary)] truncate">{h}</p>
                      {samples.length > 0 ? (
                        <p className="text-caption text-[var(--text-tertiary)] truncate">
                          {samples.map((s) => `"${s}"`).join('  ·  ')}
                        </p>
                      ) : (
                        <p className="text-caption text-[var(--text-tertiary)] italic">empty in the first rows</p>
                      )}
                    </div>
                    <ArrowRight className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <select aria-label={`Map column ${h} to`}
                          value={mapping[h] || ''}
                          onChange={(e) => { setMapping({ ...mapping, [h]: e.target.value }); setUsingTemplate(false); }}
                          className={cn(
                            'flex-1 min-w-0 h-8 px-2.5 rounded-md border bg-[var(--bg-elevated)] text-body text-[var(--text-primary)] outline-none transition-all',
                            isDuplicate ? 'border-rose-500/50 focus:ring-2 focus:ring-rose-500/20'
                              : isEmail   ? 'border-emerald-500/40 focus:ring-2 focus:ring-emerald-500/20'
                                          : 'border-[var(--border-subtle)] focus:border-[var(--indigo)] focus:ring-2 focus:ring-[var(--indigo)]/15'
                          )}
                        >
                          {IMPORT_TARGET_GROUPS.map((g) => (
                            <optgroup key={g.label} label={g.label}>
                              {g.targets.map((t) => (
                                <option key={t || 'skip'} value={t}>
                                  {t === '' ? '— Skip this column —' : t === 'email' ? 'Email (required)' : IMPORT_TARGET_LABELS[t]}
                                </option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                        {isEmail && (
                          <span className="inline-flex items-center gap-1 px-1.5 h-[18px] rounded bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 text-micro font-bold flex-shrink-0">
                            <MailCheck className="h-2.5 w-2.5" />
                            KEY
                          </span>
                        )}
                        {isDuplicate && (
                          <span className="inline-flex items-center gap-1 px-1.5 h-[18px] rounded bg-rose-500/10 text-rose-700 dark:text-rose-400 text-micro font-bold flex-shrink-0">
                            DUP
                          </span>
                        )}
                      </div>
                      {notes[h] && mapping[h] === autoMapping[h] && (
                        <p className="text-caption text-[var(--text-tertiary)] mt-0.5 truncate" title={notes[h]}>{notes[h]}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          )}

          {/* People already here, and tags. */}
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 space-y-4">
            <div>
              <p className="text-body font-semibold text-[var(--text-primary)]">
                People already in Sincerely{existingCount ? ` (${existingCount.toLocaleString()} in this file)` : ''}
              </p>
              <div role="radiogroup" aria-label="People already in Sincerely" className="mt-2 grid gap-2 sm:grid-cols-3">
                {MODE_OPTIONS.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    role="radio"
                    aria-checked={mode === m.id}
                    onClick={() => setMode(m.id)}
                    className={cn(
                      'text-left rounded-lg border px-3 py-2 transition-colors',
                      mode === m.id ? 'border-[var(--indigo)] bg-[var(--indigo-subtle)]' : 'border-[var(--border-subtle)] hover:bg-[var(--bg-hover)]',
                    )}
                  >
                    <span className="block text-body font-semibold text-[var(--text-primary)]">{m.label}</span>
                    <span className="block text-caption text-[var(--text-tertiary)]">{m.hint}</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-body font-semibold text-[var(--text-primary)]">Tag everyone in this import <span className="font-normal text-[var(--text-tertiary)]">(optional)</span></p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {(allTags || []).map((t) => {
                  const on = tagIds.includes(t.id);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setTagIds((prev) => (on ? prev.filter((x) => x !== t.id) : [...prev, t.id]))}
                      className={cn(
                        'inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border text-caption font-medium transition-colors',
                        on ? 'border-[var(--indigo)] bg-[var(--indigo-subtle)] text-[var(--indigo-text)]' : 'border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]',
                      )}
                    >
                      <span className="h-2 w-2 rounded-full" style={{ background: t.color }} />
                      {t.name}
                      {on && <Check className="h-3 w-3" strokeWidth={3} />}
                    </button>
                  );
                })}
                <form onSubmit={(e) => { e.preventDefault(); addNewTag(); }} className="inline-flex items-center gap-1">
                  <input
                    aria-label="New tag"
                    value={newTag}
                    onChange={(e) => setNewTag(e.target.value)}
                    placeholder="New tag"
                    maxLength={50}
                    className="h-7 w-28 px-2 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-caption text-[var(--text-primary)] outline-none focus:border-[var(--indigo)]"
                  />
                  {newTag.trim() && (
                    <button type="submit" className="icon-btn" aria-label="Add tag"><Plus className="h-3.5 w-3.5" /></button>
                  )}
                </form>
              </div>
              {review.other.some((h) => mapping[h] === 'tags') && (
                <p className="text-caption text-[var(--text-tertiary)] mt-1">Tags in your file's "{review.other.find((h) => mapping[h] === 'tags')}" column are added too.</p>
              )}
            </div>
          </div>

          {/* List assignment */}
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
            <div className="flex items-start gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--indigo)]/10 text-[var(--indigo-text)] flex-shrink-0 mt-0.5">
                <FolderOpen className="h-4 w-4" />
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-body font-semibold text-[var(--text-primary)]">Add to a list <span className="font-normal text-[var(--text-tertiary)]">(optional)</span></p>
                <p className="text-caption text-[var(--text-tertiary)] mb-2.5">
                  {importAs === 'contact'
                    ? 'Everyone lands in All contacts. A contact list groups this batch in your CRM.'
                    : 'Everyone lands in All leads. A lead list groups this batch so a campaign can send to it.'}
                </p>

                {/* Three-way choice — creating the list here saves a detour to
                    the lists page and back before every import. */}
                <div className="flex items-center gap-1 p-1 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-subtle)] mb-2.5">
                  {([
                    { id: 'none', label: 'No list' },
                    { id: 'existing', label: 'Existing list' },
                    { id: 'new', label: 'New list' },
                  ] as const).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => {
                        setListMode(opt.id);
                        if (opt.id !== 'existing') setTargetListId('');
                        if (opt.id === 'new' && !newListName) setNewListName(suggestedListName);
                      }}
                      className={cn(
                        'flex-1 inline-flex items-center justify-center gap-1.5 h-7 rounded-md text-body font-medium transition-colors',
                        listMode === opt.id
                          ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-[0_1px_2px_rgba(0,0,0,0.06)]'
                          : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                      )}
                    >
                      {opt.id === 'new' && <Plus className="h-3 w-3" />}
                      {opt.label}
                    </button>
                  ))}
                </div>

                {listMode === 'existing' && (
                  kindLists.length === 0 ? (
                    <p className="text-body text-[var(--text-tertiary)]">
                      You don't have any lists yet — switch to <span className="font-medium text-[var(--text-primary)]">New list</span> to create one as part of this import.
                    </p>
                  ) : (
                    <select aria-label="List to add contacts to"
                      value={targetListId}
                      onChange={(e) => setTargetListId(e.target.value)}
                      className="w-full h-9 px-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-strong text-[var(--text-primary)] outline-none focus:border-[var(--indigo)] focus:ring-2 focus:ring-[var(--indigo)]/15 transition-all"
                    >
                      <option value="">{importAs === 'contact' ? 'Choose a contact list…' : 'Choose a lead list…'}</option>
                      {kindLists.map((l) => (
                        <option key={l.id} value={l.id}>{l.name} ({l.contact_count} {l.contact_count === 1 ? 'person' : 'people'})</option>
                      ))}
                    </select>
                  )
                )}

                <div className="mb-3">
                  <p className="text-caption font-medium text-[var(--text-secondary)] mb-1.5">Import as</p>
                  <div role="radiogroup" aria-label="Import as" className="flex items-center gap-1">
                    {([
                      { id: 'prospect', label: 'Leads', hint: 'People to prospect. They go on the Leads page and move to Contacts by themselves when they reply.' },
                      { id: 'contact', label: 'Contacts', hint: 'People you already know. They go on the Contacts page straight away.' },
                    ] as const).map((k) => (
                      <button
                        key={k.id}
                        type="button"
                        role="radio"
                        aria-checked={importAs === k.id}
                        title={k.hint}
                        onClick={() => setImportAs(k.id)}
                        className={cn(
                          'inline-flex items-center h-7 px-2.5 rounded-md text-body font-medium transition-colors',
                          importAs === k.id
                            ? 'bg-[var(--indigo-subtle)] text-[var(--indigo-text)]'
                            : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]',
                        )}
                      >
                        {k.label}
                      </button>
                    ))}
                  </div>
                  <p className="text-caption text-[var(--text-tertiary)] mt-1">
                    {importAs === 'prospect'
                      ? 'They go on the Leads page, into a lead list if you pick one, and move to Contacts when they reply.'
                      : 'They go on the Contacts page, into a contact list if you pick one. Cold campaigns never send to contact lists.'}
                  </p>
                </div>

                {listMode === 'new' && (
                  <div>
                    <input aria-label="New list name"
                      value={newListName}
                      onChange={(e) => setNewListName(e.target.value)}
                      placeholder="e.g. Q3 logistics leads"
                      maxLength={80}
                      className={cn(
                        'w-full h-9 px-3 rounded-lg border bg-[var(--bg-elevated)] text-strong text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none transition-all focus:ring-2 focus:ring-[var(--indigo)]/15',
                        duplicateListName ? 'border-amber-500/50 focus:border-amber-500' : 'border-[var(--border-subtle)] focus:border-[var(--indigo)]'
                      )}
                    />
                    <p className={cn(
                      'text-caption mt-1',
                      duplicateListName ? 'text-amber-600 dark:text-amber-400' : 'text-[var(--text-tertiary)]'
                    )}>
                      {duplicateListName
                        ? `You already have a list called "${newListName.trim()}" — pick another name, or choose it under Existing list.`
                        : 'The list is created when the import starts, with these contacts in it.'}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* What stops the import. Skipped rows are in the summary card. */}
          {!mappingValid && (
            <div className="flex items-start gap-2.5 px-3.5 py-2.5 rounded-lg border bg-rose-500/8 border-rose-500/25">
              <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5 text-rose-500" />
              <div className="flex-1 min-w-0 space-y-0.5">
                {problems.map((p) => (
                  <p key={p} className="text-body font-semibold text-rose-700 dark:text-rose-400">{p}</p>
                ))}
                {!hasEmail && (
                  <p className="text-caption text-rose-600 dark:text-rose-400">We could not find a column of email addresses - pick it in the list above.</p>
                )}
              </div>
            </div>
          )}

          {/* Action bar - stays in view, so the button is never a scroll away. */}
          <div className="sticky bottom-0 z-10 -mx-1 px-1 py-3 flex items-center justify-between gap-3 border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-[0_-8px_16px_-12px_rgba(0,0,0,0.25)]" data-import-actions>
            <button
              onClick={reset}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] text-body font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-all flex-shrink-0"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Pick a different file</span>
              <span className="sm:hidden">Back</span>
            </button>
            <p className="hidden md:block flex-1 min-w-0 text-caption text-[var(--text-tertiary)] truncate text-center">
              {[
                importAs === 'contact' ? 'As contacts' : 'As leads',
                listMode === 'existing' && targetListId ? `into "${(lists || []).find((l) => l.id === targetListId)?.name ?? 'list'}"` : listMode === 'new' && newListName.trim() ? `into new list "${newListName.trim()}"` : 'no list',
                tagIds.length ? `${tagIds.length} tag${tagIds.length === 1 ? '' : 's'}` : null,
                `existing: ${MODE_OPTIONS.find((m) => m.id === mode)!.label.toLowerCase()}`,
              ].filter(Boolean).join(' · ')}
            </p>
            {/* Three conditions used to share one grey rectangle, and the
                explanation that WAS written here never appeared: a disabled
                control dispatches no pointer events, so its title is not
                shown. Ordered the way the page reads. */}
            <button
              {...blockedProps(firstBlocker([
                [!mappingValid, 'Map the columns you want to import first'],
                [importableCount === 0 && !(keepHeld && holdable.length > 0), 'Nothing in this file can be imported yet'],
                [!listChoiceValid, 'Choose a list, name a new one, or switch to "No list"'],
              ]), startImport)}
              className={cn(
                'inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-[var(--indigo)] text-white text-body font-semibold hover:bg-[var(--indigo-hover)] transition-all shadow-[var(--glow-indigo)]',
                (!mappingValid || (importableCount === 0 && !(keepHeld && holdable.length > 0)) || !listChoiceValid) && BLOCKED_CLASS,
              )}
            >
              <Users className="h-3.5 w-3.5" />
              {importableCount === 0 && keepHeld && holdable.length > 0
                ? `Keep ${holdable.length.toLocaleString()} without an email`
                : `Import ${importableCount.toLocaleString()} ${importableCount === 1 ? pageWord.slice(0, -1) : pageWord}`}
            </button>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════ */}
      {/* STEP 3 — Importing                                       */}
      {/* ════════════════════════════════════════════════════════ */}
      {step === 'importing' && (
        <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6">
          {/* Big progress bar */}
          <div className="space-y-3 mb-6">
            <div className="flex items-baseline justify-between">
              <span className="text-strong font-semibold text-[var(--text-primary)]">
                Importing batch {progress.currentBatch} of {progress.totalBatches}
              </span>
              <span className="text-title font-bold tabular text-[var(--text-primary)] tracking-[-0.02em]">
                {progress.total > 0 ? Math.round((progress.processed / progress.total) * 100) : 0}%
              </span>
            </div>
            <div className="h-2.5 bg-[var(--bg-elevated)] rounded-full overflow-hidden">
              <div
                className="h-full bg-[var(--indigo)] rounded-full transition-all duration-300"
                style={{ width: `${progress.total > 0 ? (progress.processed / progress.total) * 100 : 0}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-caption text-[var(--text-tertiary)] tabular">
              <span>{progress.processed.toLocaleString()} of {progress.total.toLocaleString()} processed</span>
              <span className="flex items-center gap-1.5">
                <Loader2 className="h-3 w-3 animate-spin" />
                {Math.max(0, progress.total - progress.processed).toLocaleString()} remaining
              </span>
            </div>
          </div>

          {/* Live counters */}
          <div className="grid grid-cols-3 gap-3 mb-5">
            <div className="rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                <span className="text-micro font-bold text-[var(--text-tertiary)]">Imported</span>
              </div>
              <p className="text-display font-semibold tabular text-emerald-600 dark:text-emerald-400 tracking-[-0.02em] leading-none">
                {progress.imported.toLocaleString()}
              </p>
            </div>
            <div className="rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <Loader2 className="h-3.5 w-3.5 text-[var(--indigo-text)] animate-spin" />
                <span className="text-micro font-bold text-[var(--text-tertiary)]">Processing</span>
              </div>
              <p className="text-display font-semibold tabular text-[var(--indigo-text)] tracking-[-0.02em] leading-none">
                {progress.processed.toLocaleString()}
              </p>
            </div>
            <div className="rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <XCircle className="h-3.5 w-3.5 text-rose-500" />
                <span className="text-micro font-bold text-[var(--text-tertiary)]">Skipped</span>
              </div>
              <p className="text-display font-semibold tabular text-rose-600 dark:text-rose-400 tracking-[-0.02em] leading-none">
                {progress.errors.toLocaleString()}
              </p>
            </div>
          </div>

          {/* Recent issues live preview */}
          {progress.errorDetails.length > 0 && (
            <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3 mb-5">
              <p className="text-micro font-bold text-[var(--text-tertiary)] mb-2 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3 text-amber-500" />
                Recent issues
              </p>
              <div className="space-y-1 max-h-24 overflow-y-auto">
                {progress.errorDetails.slice(-5).reverse().map((e, i) => (
                  <div key={i} className="flex items-center gap-2 text-caption">
                    <span className="font-mono text-[var(--text-secondary)] truncate flex-1">{e.email}</span>
                    <span className="text-rose-600 dark:text-rose-400 text-micro flex-shrink-0">{e.reason}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Cancel */}
          <div className="flex items-center justify-between border-t border-[var(--border-subtle)] pt-4">
            <p className="text-caption text-[var(--text-tertiary)]">
              You can leave this page - the import keeps going and shows in the corner. Closing the browser tab would stop it.
            </p>
            <button
              onClick={cancel}
              disabled={cancelRequested}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-rose-500/30 text-body font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 disabled:opacity-40 transition-all"
            >
              <X className="h-3.5 w-3.5" />
              Cancel import
            </button>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════ */}
      {/* STEP 4 — Complete                                        */}
      {/* ════════════════════════════════════════════════════════ */}
      {step === 'complete' && completedResult && (
        <div className="space-y-4">
          {/* Hero result */}
          <div className={cn(
            'rounded-2xl border p-5 flex items-start gap-4',
            completedResult.errors === 0
              ? 'border-emerald-500/30 bg-emerald-500/[0.06]'
              : completedResult.imported > 0
                ? 'border-amber-500/30 bg-amber-500/[0.06]'
                : 'border-rose-500/30 bg-rose-500/[0.06]'
          )}>
            <span className={cn(
              'flex h-12 w-12 items-center justify-center rounded-2xl flex-shrink-0',
              completedResult.errors === 0
                ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                : completedResult.imported > 0
                  ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                  : 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
            )}>
              {completedResult.errors === 0
                ? <CheckCircle2 className="h-6 w-6" />
                : completedResult.imported > 0
                  ? <AlertTriangle className="h-6 w-6" />
                  : <XCircle className="h-6 w-6" />}
            </span>
            <div className="flex-1 min-w-0">
              <h2 className="text-heading font-semibold text-[var(--text-primary)]">
                {completedResult.cancelled
                  ? `Cancelled — ${completedResult.imported.toLocaleString()} contact${completedResult.imported === 1 ? '' : 's'} imported before stopping`
                  : completedResult.errors === 0
                    ? `Imported ${completedResult.imported.toLocaleString()} contact${completedResult.imported === 1 ? '' : 's'}`
                    : completedResult.imported > 0
                      ? `Imported ${completedResult.imported.toLocaleString()} contacts with ${completedResult.errors.toLocaleString()} issue${completedResult.errors === 1 ? '' : 's'}`
                      : 'Import failed — no contacts were added'}
              </h2>
              <p className="text-body text-[var(--text-secondary)] mt-1">
                {completedResult.cancelled
                  ? `Processed ${completedResult.attempted.toLocaleString()} of ${completedResult.total.toLocaleString()} rows before cancelling`
                  : `Processed ${completedResult.total.toLocaleString()} rows`} in {(completedResult.durationMs / 1000).toFixed(1)} seconds
                {(() => {
                  if (createdListName) return ` · Added to the new list "${createdListName}"`;
                  const list = targetListId ? (lists || []).find((l) => l.id === targetListId) : null;
                  return list ? ` · Added to "${list.name}"` : '';
                })()}.
              </p>
            </div>
          </div>

          {/* Counters */}
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] p-4">
              <div className="flex items-center gap-1.5 mb-2">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                <span className="text-micro font-bold text-[var(--text-tertiary)]">Imported</span>
              </div>
              <p className="text-hero font-semibold tabular text-emerald-600 dark:text-emerald-400 tracking-[-0.02em] leading-none">
                {completedResult.imported.toLocaleString()}
              </p>
            </div>
            <div className="rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] p-4">
              <div className="flex items-center gap-1.5 mb-2">
                <XCircle className="h-3.5 w-3.5 text-rose-500" />
                <span className="text-micro font-bold text-[var(--text-tertiary)]">Skipped</span>
              </div>
              <p className="text-hero font-semibold tabular text-rose-600 dark:text-rose-400 tracking-[-0.02em] leading-none">
                {completedResult.errors.toLocaleString()}
              </p>
            </div>
            <div className="rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] p-4">
              <div className="flex items-center gap-1.5 mb-2">
                <Users className="h-3.5 w-3.5 text-[var(--text-secondary)]" />
                <span className="text-micro font-bold text-[var(--text-tertiary)]">
                  {completedResult.cancelled ? 'Rows attempted' : 'Total rows'}
                </span>
              </div>
              <p className="text-hero font-semibold tabular text-[var(--text-primary)] tracking-[-0.02em] leading-none">
                {completedResult.cancelled
                  ? `${completedResult.attempted.toLocaleString()} / ${completedResult.total.toLocaleString()}`
                  : completedResult.total.toLocaleString()}
              </p>
            </div>
          </div>

          {/* Where they went - otherwise a prospect import looks like it did
              nothing, because the Contacts tab is unchanged. */}
          {!completedResult.cancelled && completedResult.imported > 0 && (
            <p className="text-body text-[var(--text-secondary)]">
              {filedAs === 'contact'
                ? 'Filed as contacts - they are on the Contacts page.'
                : 'Filed as leads - they are on the Leads page, and move to Contacts when they reply.'}
            </p>
          )}

          {/* New versus already there: a re-import only fills empty fields,
              and should say so rather than look like it added everyone. */}
          {(completedResult.updated > 0 || completedResult.suppressed > 0) && (
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-3 space-y-1">
              {completedResult.updated > 0 && (
                <p className="text-body text-[var(--text-secondary)]">
                  {completedResult.created.toLocaleString()} new, {completedResult.updated.toLocaleString()} already in Sincerely - {mode === 'overwrite'
                    ? 'for those, the values in your file replaced what was there (empty cells changed nothing).'
                    : mode === 'skip'
                      ? 'those were left exactly as they were.'
                      : 'for those, only empty fields were filled in.'}
                </p>
              )}
              {completedResult.suppressed > 0 && (
                <p className="text-body text-amber-700 dark:text-amber-400">
                  {completedResult.suppressed.toLocaleString()} {completedResult.suppressed === 1 ? 'address is' : 'addresses are'} on your suppression list, so no campaign will email {completedResult.suppressed === 1 ? 'it' : 'them'}.
                </p>
              )}
            </div>
          )}

          {heldCount > 0 && (
            <div className="flex items-center gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-3" data-import-held>
              <span className="h-2.5 w-2.5 rounded-full bg-slate-400 ring-2 ring-slate-400/25 flex-shrink-0" />
              <p className="flex-1 text-body text-[var(--text-secondary)]">
                {heldCount.toLocaleString()} {heldCount === 1 ? 'person' : 'people'} without an email {heldCount === 1 ? 'is' : 'are'} kept in the list as <strong className="font-semibold text-[var(--text-primary)]">No email</strong>. Add their address there, or re-import the fixed file.
              </p>
            </div>
          )}

          {/* The rows that never went in, to fix and re-upload. */}
          {setAsideCount > 0 && (
            <div className="flex items-center gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-3">
              <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0" />
              <p className="flex-1 text-body text-[var(--text-secondary)]">
                {setAsideCount.toLocaleString()} {setAsideCount === 1 ? 'row was' : 'rows were'} not imported (no email, not an address, or marked by your old tool).
              </p>
              <button type="button" onClick={downloadSetAside} className="btn-secondary flex-shrink-0">
                <Download className="h-3.5 w-3.5" />
                Download them
              </button>
            </div>
          )}

          {/* Error details */}
          {completedResult.errorDetails.length > 0 && (
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-hidden">
              <div className="px-4 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)] flex items-center justify-between">
                <p className="text-body font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                  {completedResult.errorDetails.length === completedResult.errors
                    ? `${completedResult.errors} issue${completedResult.errors === 1 ? '' : 's'}`
                    : `Showing first ${completedResult.errorDetails.length} of ${completedResult.errors} issues`}
                </p>
                <button
                  onClick={downloadErrors}
                  className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-caption font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
                >
                  <Download className="h-3 w-3" />
                  Download CSV
                </button>
              </div>
              <div className="max-h-64 overflow-y-auto">
                {completedResult.errorDetails.map((e, i) => (
                  <div key={i} className="flex items-center gap-3 px-4 py-2 border-b border-[var(--border-subtle)] last:border-0 text-caption">
                    <span className="font-mono text-[var(--text-secondary)] truncate flex-1">{e.email}</span>
                    <span className="text-rose-600 dark:text-rose-400 flex-shrink-0">{e.reason}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Action bar */}
          <div className="flex items-center justify-between pt-2">
            <div className="flex items-center gap-2">
              <button
                onClick={reset}
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] text-body font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-all"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Import another file
              </button>
              {/* A wrong file is one click to take back, not an afternoon. */}
              {completedResult.createdIds.length > 0 && !undone && (
                <button
                  onClick={undoImport}
                  className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-body font-medium text-[var(--text-secondary)] hover:text-rose-600 hover:bg-rose-500/10 transition-all"
                  data-undo-import
                >
                  <Undo2 className="h-3.5 w-3.5" />
                  Undo import
                </button>
              )}
              {undone && <span className="text-caption text-[var(--text-tertiary)]">Import undone</span>}
            </div>
            <div className="flex items-center gap-2">
              {/* The next thing almost everyone does with a fresh list, one
                  click away instead of three pages. */}
              {targetListId && completedResult.imported > 0 && filedAs === 'prospect' && (
                <button
                  onClick={() => navigate(`/campaigns/new?list=${targetListId}`)}
                  className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] text-body font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-all"
                  data-start-campaign
                >
                  <Send className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Start a campaign with them</span>
                  <span className="sm:hidden">Campaign</span>
                </button>
              )}
              <button
                onClick={() => {
                  const base = filedAs === 'contact' ? '/contacts' : '/leads';
                  navigate(targetListId ? `${base}?list=${targetListId}` : base);
                }}
                className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-[var(--indigo)] text-white text-body font-semibold hover:bg-[var(--indigo-hover)] transition-all shadow-[var(--glow-indigo)]"
              >
                {filedAs === 'contact' ? 'View contacts' : 'View leads'}
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </>
  );
}
