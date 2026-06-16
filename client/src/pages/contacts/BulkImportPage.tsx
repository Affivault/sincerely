import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import Papa from 'papaparse';
import { contactsApi, listsApi, type BulkImportResult } from '../../api/contacts.api';
import { cn } from '../../lib/utils';
import {
  ArrowLeft, Upload, FileText, X, Check, AlertTriangle,
  ArrowRight, Users, Loader2, CheckCircle2, XCircle, Eye,
  FolderOpen, RotateCcw, Download, AlertCircle, MailCheck,
} from 'lucide-react';
import toast from 'react-hot-toast';

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

const DB_FIELDS = [
  { value: '',           label: '— Skip this column —' },
  { value: 'email',       label: 'Email (required)' },
  { value: 'first_name',  label: 'First name' },
  { value: 'last_name',   label: 'Last name' },
  { value: 'company',     label: 'Company' },
  { value: 'job_title',   label: 'Job title' },
  { value: 'phone',       label: 'Phone' },
  { value: 'linkedin_url',label: 'LinkedIn URL' },
  { value: 'website',     label: 'Website' },
  { value: '__custom__',  label: 'Custom field (keep column name)' },
];

const BATCH_SIZE = 100;
const MAX_PREVIEW_ROWS = 5;

function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function detectMapping(header: string): string {
  const h = header.toLowerCase().trim().replace(/[_\s-]+/g, '');
  if (h === 'email' || h === 'emailaddress' || h.endsWith('email')) return 'email';
  if (h === 'firstname' || h === 'fname' || h === 'given' || h === 'givenname') return 'first_name';
  if (h === 'lastname' || h === 'lname' || h === 'surname' || h === 'familyname') return 'last_name';
  if (h === 'company' || h === 'organization' || h === 'organisation' || h === 'companyname') return 'company';
  if (h === 'jobtitle' || h === 'title' || h === 'role' || h === 'position') return 'job_title';
  if (h === 'phone' || h === 'phonenumber' || h === 'mobile' || h === 'tel') return 'phone';
  if (h.includes('linkedin')) return 'linkedin_url';
  if (h === 'website' || h === 'url' || h === 'site') return 'website';
  return '';
}

export function BulkImportPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [previewRows, setPreviewRows] = useState<Record<string, string>[]>([]);
  const [allRows, setAllRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [targetListId, setTargetListId] = useState<string>('');
  const [progress, setProgress] = useState<ImportProgress>({
    total: 0, processed: 0, imported: 0, errors: 0,
    errorDetails: [], currentBatch: 0, totalBatches: 0,
  });
  const [completedResult, setCompletedResult] = useState<{
    total: number; imported: number; errors: number;
    errorDetails: { email: string; reason: string }[];
    durationMs: number;
  } | null>(null);
  const cancelRef = useRef(false);
  const [cancelRequested, setCancelRequested] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  // Stop the import loop if the user navigates away mid-import
  useEffect(() => {
    return () => { cancelRef.current = true; };
  }, []);

  const { data: lists } = useQuery({
    queryKey: ['lists'],
    queryFn: listsApi.list,
  });

  // Parse CSV file the moment a file is selected
  const handleFile = useCallback((f: File) => {
    setParseError(null);
    setFile(f);

    if (!/\.(csv|tsv|txt)$/i.test(f.name)) {
      setParseError('Please upload a .csv file.');
      return;
    }
    if (f.size > 50 * 1024 * 1024) {
      setParseError('File too large — maximum 50 MB.');
      return;
    }

    Papa.parse<Record<string, string>>(f, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (h) => h.trim().replace(/^﻿/, ''),
      complete: (result) => {
        if (result.errors.length > 0 && result.data.length === 0) {
          setParseError(`Could not parse this file: ${result.errors[0].message}`);
          return;
        }
        const rows = (result.data || []).filter(
          (r) => r && Object.values(r).some((v) => v && String(v).trim())
        );
        if (rows.length === 0) {
          setParseError('The CSV file has no data rows.');
          return;
        }
        const detected = (result.meta.fields || []).map((h) => h.trim());
        if (detected.length === 0) {
          setParseError('Could not detect any columns in the file. Make sure it has a header row.');
          return;
        }

        // Auto-detect mapping
        const auto: Record<string, string> = {};
        for (const h of detected) {
          auto[h] = detectMapping(h);
        }

        setHeaders(detected);
        setPreviewRows(rows.slice(0, MAX_PREVIEW_ROWS));
        setAllRows(rows);
        setMapping(auto);
        setStep('map');
      },
      error: (err) => {
        setParseError(`Failed to parse file: ${err.message}`);
      },
    });
  }, []);

  const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
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
  const standardMapped = mappedFields.filter((f) => f !== '__custom__');
  const hasEmail = standardMapped.includes('email');
  const dupes = standardMapped.filter((f, i) => standardMapped.indexOf(f) !== i);
  const mappingValid = hasEmail && dupes.length === 0;

  // Compute rows that will be imported (skip ones with no mapped email)
  const importableCount = useMemo(() => {
    if (!hasEmail) return 0;
    const emailHeader = Object.entries(mapping).find(([, v]) => v === 'email')?.[0];
    if (!emailHeader) return 0;
    return allRows.filter((r) => {
      const e = r[emailHeader];
      return e && String(e).trim();
    }).length;
  }, [allRows, mapping, hasEmail]);

  // Kick off the import
  const startImport = useCallback(async () => {
    if (!mappingValid) return;
    cancelRef.current = false;
    setCancelRequested(false);
    setStep('importing');
    const startedAt = Date.now();

    const mapped = allRows.map((row) => {
      const c: Record<string, any> = {};
      for (const [csvCol, dbField] of Object.entries(mapping)) {
        if (!dbField) continue;
        const v = row[csvCol];
        if (v == null || String(v).trim() === '') continue;
        if (dbField === '__custom__') {
          // Use the CSV header as the custom-field key
          (c.custom_fields ||= {})[csvCol] = String(v).trim();
        } else {
          c[dbField] = String(v).trim();
        }
      }
      return c;
    }).filter((c) => c.email);

    const total = mapped.length;
    const totalBatches = Math.ceil(total / BATCH_SIZE);
    setProgress({
      total, processed: 0, imported: 0, errors: 0,
      errorDetails: [], currentBatch: 0, totalBatches,
    });

    if (total === 0) {
      setCompletedResult({
        total: 0, imported: 0, errors: 0, errorDetails: [], durationMs: 0,
      });
      setStep('complete');
      return;
    }

    let imported = 0;
    let errors = 0;
    const errorDetails: { email: string; reason: string }[] = [];

    for (let i = 0; i < total; i += BATCH_SIZE) {
      if (cancelRef.current) break;
      const batch = mapped.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      try {
        const result: BulkImportResult = await contactsApi.bulkCreate(batch, targetListId || undefined);
        imported += result.imported;
        errors += result.errors;
        if (result.error_details && errorDetails.length < 200) {
          errorDetails.push(...result.error_details.slice(0, 200 - errorDetails.length));
        }
      } catch (err: any) {
        errors += batch.length;
        const msg = err.response?.data?.error || err.message || 'Network error';
        for (const c of batch.slice(0, 5)) {
          errorDetails.push({ email: c.email || '(unknown)', reason: msg });
        }
      }
      setProgress({
        total,
        processed: Math.min(i + BATCH_SIZE, total),
        imported, errors, errorDetails,
        currentBatch: batchNum,
        totalBatches,
      });
      // Yield to UI between batches so the progress bar can paint
      await new Promise((r) => setTimeout(r, 0));
    }

    setCompletedResult({
      total,
      imported,
      errors,
      errorDetails,
      durationMs: Date.now() - startedAt,
    });
    setStep('complete');
  }, [allRows, mapping, mappingValid, targetListId]);

  const cancel = () => {
    cancelRef.current = true;
    setCancelRequested(true);
    toast('Cancelling after current batch…', { icon: '⏸' });
  };

  // Reset to start over
  const reset = () => {
    cancelRef.current = false;
    setCancelRequested(false);
    setFile(null);
    setParseError(null);
    setHeaders([]);
    setPreviewRows([]);
    setAllRows([]);
    setMapping({});
    setTargetListId('');
    setCompletedResult(null);
    setProgress({ total: 0, processed: 0, imported: 0, errors: 0, errorDetails: [], currentBatch: 0, totalBatches: 0 });
    setStep('upload');
  };

  // Download error log as CSV
  const downloadErrors = () => {
    const details = completedResult?.errorDetails || [];
    if (details.length === 0) return;
    const csv = 'email,reason\n' + details.map(
      (e) => `"${(e.email || '').replace(/"/g, '""')}","${(e.reason || '').replace(/"/g, '""')}"`
    ).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `import-errors-${Date.now()}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 100);
  };

  // Steps strip
  const stepConfig: { id: Step; label: string; icon: any }[] = [
    { id: 'upload',    label: 'Upload',    icon: Upload     },
    { id: 'map',       label: 'Map fields', icon: ArrowRight },
    { id: 'importing', label: 'Import',    icon: Loader2    },
    { id: 'complete',  label: 'Done',      icon: CheckCircle2 },
  ];
  const currentStepIdx = stepConfig.findIndex((s) => s.id === step);

  return (
    <div className="space-y-5 max-w-4xl">
      {/* ── Top: back + step indicator ──────────────────────────── */}
      <div className="flex items-center justify-between gap-4">
        <button
          onClick={() => navigate('/contacts')}
          className="flex items-center gap-1.5 px-2 h-7 rounded-md text-[12px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
          disabled={step === 'importing'}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Contacts
        </button>
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
                    current && 'bg-[var(--indigo)] text-white shadow-[0_1px_3px_rgba(91,91,245,0.5)]',
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
                  'text-[11.5px] font-semibold transition-colors hidden sm:inline',
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
      </div>

      {/* ── Hero ────────────────────────────────────────────────── */}
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--indigo)] shadow-[0_1px_3px_rgba(91,91,245,0.4)]">
          <Upload className="h-4 w-4 text-white" />
        </span>
        <div>
          <h1 className="text-[22px] font-semibold text-[var(--text-primary)] leading-[1.15] tracking-[-0.02em]">
            Import contacts from CSV
          </h1>
          <p className="text-[13px] text-[var(--text-secondary)] mt-0.5">
            {step === 'upload'    && 'Upload a CSV file with your leads — we\'ll detect columns automatically.'}
            {step === 'map'       && 'Match each CSV column to the right contact field, then start the import.'}
            {step === 'importing' && 'Hang tight — your contacts are being added in batches.'}
            {step === 'complete'  && 'All done. Here\'s what happened.'}
          </p>
        </div>
      </div>

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
              'relative flex flex-col items-center justify-center min-h-[280px] rounded-2xl border-2 border-dashed cursor-pointer transition-all p-8 text-center',
              isDragging
                ? 'border-[var(--indigo)] bg-[#5B5BF5]/5 scale-[1.005]'
                : 'border-[var(--border-default)] bg-[var(--bg-surface)] hover:border-[#5B5BF5]/40 hover:bg-[var(--bg-hover)]'
            )}
          >
            <input
              type="file"
              accept=".csv,.tsv,.txt"
              onChange={onFileInput}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />
            <span className={cn(
              'flex h-14 w-14 items-center justify-center rounded-2xl mb-4 transition-all',
              isDragging
                ? 'bg-[var(--indigo)] text-white scale-110'
                : 'bg-[#5B5BF5]/10 text-[var(--indigo)]'
            )}>
              <Upload className="h-6 w-6" strokeWidth={1.5} />
            </span>
            <p className="text-[14px] font-semibold text-[var(--text-primary)] mb-1">
              {isDragging ? 'Drop your CSV here' : 'Drop a CSV file here or click to browse'}
            </p>
            <p className="text-[12px] text-[var(--text-secondary)]">
              We support .csv, .tsv, and .txt files up to 50 MB
            </p>
          </label>

          {parseError && (
            <div className="flex items-start gap-2.5 px-3.5 py-2.5 rounded-lg bg-rose-500/10 border border-rose-500/25">
              <AlertCircle className="h-4 w-4 text-rose-500 flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-[12.5px] font-semibold text-rose-700 dark:text-rose-400">Couldn't read this file</p>
                <p className="text-[11.5px] text-rose-600 dark:text-rose-400 mt-0.5">{parseError}</p>
              </div>
              <button onClick={() => { setFile(null); setParseError(null); }} className="p-1 rounded hover:bg-rose-500/10">
                <X className="h-3 w-3 text-rose-500" />
              </button>
            </div>
          )}

          {/* Requirements box */}
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--text-tertiary)] mb-2.5">
              Tips for a smooth import
            </p>
            <ul className="space-y-1.5 text-[12.5px] text-[var(--text-secondary)]">
              <li className="flex items-start gap-2">
                <Check className="h-3.5 w-3.5 text-emerald-500 mt-0.5 flex-shrink-0" />
                <span>Your CSV must include a header row in the first line.</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="h-3.5 w-3.5 text-emerald-500 mt-0.5 flex-shrink-0" />
                <span>An <span className="font-mono text-[11.5px] px-1 py-0.5 rounded bg-[var(--bg-elevated)]">email</span> column is required — other fields are optional.</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="h-3.5 w-3.5 text-emerald-500 mt-0.5 flex-shrink-0" />
                <span>Existing contacts are updated automatically (matched by email).</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="h-3.5 w-3.5 text-emerald-500 mt-0.5 flex-shrink-0" />
                <span>Common column names like "First Name", "Company", or "LinkedIn" are detected for you.</span>
              </li>
            </ul>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════ */}
      {/* STEP 2 — Map fields                                      */}
      {/* ════════════════════════════════════════════════════════ */}
      {step === 'map' && (
        <div className="space-y-4">
          {/* File info bar */}
          <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#5B5BF5]/10 text-[var(--indigo)] flex-shrink-0">
              <FileText className="h-4 w-4" />
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-semibold text-[var(--text-primary)] truncate">{file?.name}</p>
              <p className="text-[11.5px] text-[var(--text-tertiary)]">
                {bytes(file?.size || 0)} · {allRows.length.toLocaleString()} rows · {headers.length} columns
              </p>
            </div>
            <button onClick={reset} className="icon-btn flex-shrink-0" title="Pick a different file">
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Field mapping */}
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-hidden">
            <div className="px-4 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)] flex items-center justify-between">
              <div>
                <p className="text-[12.5px] font-semibold text-[var(--text-primary)]">Column mapping</p>
                <p className="text-[11px] text-[var(--text-tertiary)]">Match your CSV columns to contact fields. Skip any you don't need.</p>
              </div>
              <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-tertiary)]">
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
                const isDuplicate = mapping[h] && mappedFields.filter((f) => f === mapping[h]).length > 1;
                const isEmail = mapping[h] === 'email';
                return (
                  <div key={`${h}-${i}`} className="grid grid-cols-[1fr,auto,1fr] gap-3 items-center px-4 py-2.5">
                    <div className="min-w-0">
                      <p className="text-[12.5px] font-mono font-semibold text-[var(--text-primary)] truncate">{h}</p>
                      {samples.length > 0 && (
                        <p className="text-[11px] text-[var(--text-tertiary)] truncate">
                          {samples.map((s) => `"${s}"`).join('  ·  ')}
                        </p>
                      )}
                    </div>
                    <ArrowRight className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
                    <div className="flex items-center gap-2">
                      <select
                        value={mapping[h] || ''}
                        onChange={(e) => setMapping({ ...mapping, [h]: e.target.value })}
                        className={cn(
                          'flex-1 h-8 px-2.5 rounded-md border bg-[var(--bg-elevated)] text-[12.5px] text-[var(--text-primary)] outline-none transition-all',
                          isDuplicate ? 'border-rose-500/50 focus:ring-2 focus:ring-rose-500/20'
                            : isEmail   ? 'border-emerald-500/40 focus:ring-2 focus:ring-emerald-500/20'
                                        : 'border-[var(--border-subtle)] focus:border-[var(--indigo)] focus:ring-2 focus:ring-[#5B5BF5]/15'
                        )}
                      >
                        {DB_FIELDS.map((f) => (
                          <option key={f.value} value={f.value}>{f.label}</option>
                        ))}
                      </select>
                      {isEmail && (
                        <span className="inline-flex items-center gap-1 px-1.5 h-[18px] rounded-[4px] bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 text-[10px] font-bold flex-shrink-0">
                          <MailCheck className="h-2.5 w-2.5" />
                          KEY
                        </span>
                      )}
                      {isDuplicate && (
                        <span className="inline-flex items-center gap-1 px-1.5 h-[18px] rounded-[4px] bg-rose-500/10 text-rose-700 dark:text-rose-400 text-[10px] font-bold flex-shrink-0">
                          DUP
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* List assignment */}
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
            <label className="flex items-start gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#5B5BF5]/10 text-[var(--indigo)] flex-shrink-0 mt-0.5">
                <FolderOpen className="h-4 w-4" />
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-[12.5px] font-semibold text-[var(--text-primary)]">Add to a list <span className="font-normal text-[var(--text-tertiary)]">(optional)</span></p>
                <p className="text-[11px] text-[var(--text-tertiary)] mb-2">Imported contacts will be added to this list as well as your main contacts database.</p>
                <select
                  value={targetListId}
                  onChange={(e) => setTargetListId(e.target.value)}
                  className="w-full h-9 px-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--indigo)] focus:ring-2 focus:ring-[#5B5BF5]/15 transition-all"
                >
                  <option value="">No list — just add to All Contacts</option>
                  {(lists || []).map((l) => (
                    <option key={l.id} value={l.id}>{l.name} ({l.contact_count} contacts)</option>
                  ))}
                </select>
              </div>
            </label>
          </div>

          {/* Validation summary */}
          {(!mappingValid || importableCount < allRows.length) && (
            <div className={cn(
              'flex items-start gap-2.5 px-3.5 py-2.5 rounded-lg border',
              !mappingValid
                ? 'bg-rose-500/8 border-rose-500/25'
                : 'bg-amber-500/8 border-amber-500/25'
            )}>
              <AlertTriangle className={cn(
                'h-4 w-4 flex-shrink-0 mt-0.5',
                !mappingValid ? 'text-rose-500' : 'text-amber-500'
              )} />
              <div className="flex-1 min-w-0">
                {!hasEmail && (
                  <p className="text-[12.5px] font-semibold text-rose-700 dark:text-rose-400">Map at least one column to "Email" — it's required for every contact.</p>
                )}
                {dupes.length > 0 && (
                  <p className="text-[12.5px] font-semibold text-rose-700 dark:text-rose-400">Multiple columns are mapped to the same field. Pick a different field for each.</p>
                )}
                {mappingValid && importableCount < allRows.length && (
                  <p className="text-[12.5px] text-amber-700 dark:text-amber-400">
                    <span className="font-semibold">{(allRows.length - importableCount).toLocaleString()} rows</span> will be skipped because they have no email value.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Action bar */}
          <div className="flex items-center justify-between pt-2">
            <button
              onClick={reset}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] text-[12.5px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-all"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Pick a different file
            </button>
            <button
              onClick={startImport}
              disabled={!mappingValid || importableCount === 0}
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-[var(--indigo)] text-white text-[12.5px] font-semibold hover:bg-[#4F46E5] disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-[0_1px_3px_rgba(91,91,245,0.4)]"
            >
              <Users className="h-3.5 w-3.5" />
              Import {importableCount.toLocaleString()} contact{importableCount === 1 ? '' : 's'}
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
              <span className="text-[13px] font-semibold text-[var(--text-primary)]">
                Importing batch {progress.currentBatch} of {progress.totalBatches}
              </span>
              <span className="text-[20px] font-bold tabular text-[var(--text-primary)] tracking-[-0.02em]">
                {progress.total > 0 ? Math.round((progress.processed / progress.total) * 100) : 0}%
              </span>
            </div>
            <div className="h-2.5 bg-[var(--bg-elevated)] rounded-full overflow-hidden">
              <div
                className="h-full bg-[var(--indigo)] rounded-full transition-all duration-300"
                style={{ width: `${progress.total > 0 ? (progress.processed / progress.total) * 100 : 0}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[11.5px] text-[var(--text-tertiary)] tabular">
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
                <span className="text-[10.5px] font-bold uppercase tracking-wider text-[var(--text-tertiary)]">Imported</span>
              </div>
              <p className="text-[22px] font-semibold tabular text-emerald-600 dark:text-emerald-400 tracking-[-0.02em] leading-none">
                {progress.imported.toLocaleString()}
              </p>
            </div>
            <div className="rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <Loader2 className="h-3.5 w-3.5 text-[var(--indigo)] animate-spin" />
                <span className="text-[10.5px] font-bold uppercase tracking-wider text-[var(--text-tertiary)]">Processing</span>
              </div>
              <p className="text-[22px] font-semibold tabular text-[var(--indigo)] tracking-[-0.02em] leading-none">
                {progress.processed.toLocaleString()}
              </p>
            </div>
            <div className="rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <XCircle className="h-3.5 w-3.5 text-rose-500" />
                <span className="text-[10.5px] font-bold uppercase tracking-wider text-[var(--text-tertiary)]">Skipped</span>
              </div>
              <p className="text-[22px] font-semibold tabular text-rose-600 dark:text-rose-400 tracking-[-0.02em] leading-none">
                {progress.errors.toLocaleString()}
              </p>
            </div>
          </div>

          {/* Recent issues live preview */}
          {progress.errorDetails.length > 0 && (
            <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3 mb-5">
              <p className="text-[10.5px] font-bold uppercase tracking-wider text-[var(--text-tertiary)] mb-2 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3 text-amber-500" />
                Recent issues
              </p>
              <div className="space-y-1 max-h-24 overflow-y-auto">
                {progress.errorDetails.slice(-5).reverse().map((e, i) => (
                  <div key={i} className="flex items-center gap-2 text-[11px]">
                    <span className="font-mono text-[var(--text-secondary)] truncate flex-1">{e.email}</span>
                    <span className="text-rose-600 dark:text-rose-400 text-[10.5px] flex-shrink-0">{e.reason}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Cancel */}
          <div className="flex items-center justify-between border-t border-[var(--border-subtle)] pt-4">
            <p className="text-[11.5px] text-[var(--text-tertiary)]">
              Don't close this tab until the import finishes — leaving will stop it.
            </p>
            <button
              onClick={cancel}
              disabled={cancelRequested}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-rose-500/30 text-[12px] font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 disabled:opacity-40 transition-all"
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
              <h2 className="text-[16px] font-semibold text-[var(--text-primary)]">
                {completedResult.errors === 0
                  ? `Imported ${completedResult.imported.toLocaleString()} contact${completedResult.imported === 1 ? '' : 's'}`
                  : completedResult.imported > 0
                    ? `Imported ${completedResult.imported.toLocaleString()} contacts with ${completedResult.errors.toLocaleString()} issue${completedResult.errors === 1 ? '' : 's'}`
                    : 'Import failed — no contacts were added'}
              </h2>
              <p className="text-[12.5px] text-[var(--text-secondary)] mt-1">
                Processed {completedResult.total.toLocaleString()} rows in {(completedResult.durationMs / 1000).toFixed(1)} seconds
                {targetListId && lists && (() => {
                  const list = lists.find((l) => l.id === targetListId);
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
                <span className="text-[10.5px] font-bold uppercase tracking-wider text-[var(--text-tertiary)]">Imported</span>
              </div>
              <p className="text-[26px] font-semibold tabular text-emerald-600 dark:text-emerald-400 tracking-[-0.02em] leading-none">
                {completedResult.imported.toLocaleString()}
              </p>
            </div>
            <div className="rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] p-4">
              <div className="flex items-center gap-1.5 mb-2">
                <XCircle className="h-3.5 w-3.5 text-rose-500" />
                <span className="text-[10.5px] font-bold uppercase tracking-wider text-[var(--text-tertiary)]">Skipped</span>
              </div>
              <p className="text-[26px] font-semibold tabular text-rose-600 dark:text-rose-400 tracking-[-0.02em] leading-none">
                {completedResult.errors.toLocaleString()}
              </p>
            </div>
            <div className="rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] p-4">
              <div className="flex items-center gap-1.5 mb-2">
                <Users className="h-3.5 w-3.5 text-[var(--text-secondary)]" />
                <span className="text-[10.5px] font-bold uppercase tracking-wider text-[var(--text-tertiary)]">Total rows</span>
              </div>
              <p className="text-[26px] font-semibold tabular text-[var(--text-primary)] tracking-[-0.02em] leading-none">
                {completedResult.total.toLocaleString()}
              </p>
            </div>
          </div>

          {/* Error details */}
          {completedResult.errorDetails.length > 0 && (
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-hidden">
              <div className="px-4 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)] flex items-center justify-between">
                <p className="text-[12.5px] font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                  {completedResult.errorDetails.length === completedResult.errors
                    ? `${completedResult.errors} issue${completedResult.errors === 1 ? '' : 's'}`
                    : `Showing first ${completedResult.errorDetails.length} of ${completedResult.errors} issues`}
                </p>
                <button
                  onClick={downloadErrors}
                  className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[11.5px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
                >
                  <Download className="h-3 w-3" />
                  Download CSV
                </button>
              </div>
              <div className="max-h-64 overflow-y-auto">
                {completedResult.errorDetails.map((e, i) => (
                  <div key={i} className="flex items-center gap-3 px-4 py-2 border-b border-[var(--border-subtle)] last:border-0 text-[11.5px]">
                    <span className="font-mono text-[var(--text-secondary)] truncate flex-1">{e.email}</span>
                    <span className="text-rose-600 dark:text-rose-400 flex-shrink-0">{e.reason}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Action bar */}
          <div className="flex items-center justify-between pt-2">
            <button
              onClick={reset}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] text-[12.5px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-all"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Import another file
            </button>
            <button
              onClick={() => navigate(targetListId ? `/contacts?list=${targetListId}` : '/contacts')}
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-[var(--indigo)] text-white text-[12.5px] font-semibold hover:bg-[#4F46E5] transition-all shadow-[0_1px_3px_rgba(91,91,245,0.4)]"
            >
              View contacts
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
