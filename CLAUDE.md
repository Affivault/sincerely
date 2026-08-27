# Sincerely / Lemlist-style — Claude Workflow Instructions

## Repository
- **Repo:** `Affivault/lemlist-style`
- **Dev branch:** `claude/loving-maxwell-uiZQz` (always develop here)

## Daily Workflow (required every session)

1. **Diagnose** — read all source files under `client/src/`, `server/src/`, `shared/src/`, and `api/`; find real, concrete bugs (logic errors, missing error handling, unsafe nulls, type mismatches, memory/resource leaks, swallowed errors, etc.)
2. **Fix** — fix every confirmed issue in the code directly; skip anything that can't be resolved in code alone
3. **Improve** — make exactly one meaningful improvement per session (feature, UI, or UX) that makes a small but real difference to the Sincerely app
4. **Commit** — commit ALL changes (fixes + improvement together) in a single commit with a clear, descriptive message
5. **PR + Merge** — create **one** pull request combining everything, then merge it immediately; never split fixes and improvements into separate PRs or separate branches

## Rules
- Fixes and improvements always land in the **same** PR — do not open a PR until both are complete
- Always squash-merge into `main`
- PR title should summarise the day's work concisely
- PR body should include a table of bugs fixed and a description of the improvement

## Delivering migrations — NON-NEGOTIABLE

Whenever a change adds or alters a SQL migration, **paste the complete file
into the chat**, in a copy-and-paste-ready block, without being asked.

- Every migration, every time. If three migrations are pending, send all three,
  in the order they must be run.
- Never point at a path in the repo instead ("it's in `supabase/migrations/`").
  The user runs these by pasting into the Supabase SQL editor and does not read
  them out of the repo.
- Never abbreviate, truncate, or summarise one because it is long. Length is
  not a reason to omit it.
- Pure ASCII — no em dashes or box-drawing characters, which do not survive
  every clipboard.
- No `BEGIN`/`COMMIT`: the Supabase SQL editor wraps a pasted script in its own
  transaction, and an explicit `BEGIN` prints "there is already a transaction
  in progress", which reads as a failure.
- State the run order explicitly when more than one is pending, and call out any
  dependency between them.

## Migration numbering — check before you create one

Other work lands on `main` while a branch is open, and it brings migrations
with it. Two files claiming the same number is how one of them gets skipped,
because these are run by hand from the filenames.

Before adding a migration: `git fetch origin main` first, then number from the
highest that exists on `main`, not from the highest in your working tree.

Numbers are for humans, not Postgres. When you need to know whether a
migration has actually been applied, check for the object it creates rather
than trusting a filename or anyone's memory.

## Delivering the browser extension

Send updated builds as **zip files** in the chat. Do not send git instructions,
GitHub Desktop steps, or "pull the latest" — zips, every time.

