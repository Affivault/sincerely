import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import crypto from 'crypto';

export class AppError extends Error {
  statusCode: number;
  code?: string;
  /**
   * Structured detail that belongs to the failure itself.
   *
   * A refused launch is the case that wanted this: "you cannot send yet" is
   * useless without the list of reasons, and making the client fetch that
   * list separately means it can disagree with the one the server actually
   * decided on. Merged into the response body, so nothing here may use the
   * keys `error` or `code`.
   */
  details?: Record<string, unknown>;

  constructor(message: string, statusCode: number, code?: string, details?: Record<string, unknown>) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.name = 'AppError';
  }
}

export function errorMiddleware(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  console.error('Error:', err);

  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: err.message,
      ...(err.code ? { code: err.code } : {}),
      ...(err.details || {}),
    });
    return;
  }

  // Controllers that call schema.parse(req.body) directly (rather than going
  // through the validate() middleware) throw a raw ZodError on bad input —
  // without this it fell through to the generic 500 below, masking ordinary
  // validation failures as server errors.
  if (err instanceof ZodError) {
    res.status(400).json({ error: 'Validation failed', details: err.flatten().fieldErrors });
    return;
  }

  /*
   * Everything else used to become the string "Internal server error", full
   * stop. The detail went to the server log and the person looking at the
   * screen got nothing they could act on or even repeat back — which turns
   * every failure into a guessing game for whoever has to fix it.
   *
   * Two things change that, without putting internals on the wire:
   *
   *   - A reference. The same short id goes in the log line and in the
   *     response, so "it failed, ref a1b2c3d4" is enough to find the exact
   *     error.
   *   - A plain sentence for the database errors that have an obvious human
   *     cause. A missing table means a migration has not been run, and saying
   *     so is worth far more than a 500.
   */
  const ref = crypto.randomUUID().slice(0, 8);
  console.error(`Error [ref:${ref}]:`, err);

  const explained = explainDatabaseError(err);
  res.status(explained ? explained.status : 500).json({
    error: explained ? explained.message : 'Something went wrong on our side.',
    ref,
  });
}

/**
 * A readable sentence for the Postgres failures that have a human cause.
 *
 * Deliberately a fixed list. Anything unrecognised stays generic, so a message
 * we have not vetted can never reach a client — the reference id is how those
 * get diagnosed instead.
 */
function explainDatabaseError(err: unknown): { message: string; status: number } | null {
  const code = (err as { code?: string })?.code;
  if (!code) return null;

  switch (code) {
    case '42P01':
      return {
        message: 'The database is missing a table this needs — a migration has not been run yet.',
        status: 503,
      };
    case '42703':
      return {
        message: 'The database is missing a column this needs — a migration has not been run yet.',
        status: 503,
      };
    case '23505':
      return { message: 'That already exists.', status: 409 };
    case '23503':
      return { message: 'That refers to something which no longer exists.', status: 409 };
    case '23502':
      return { message: 'A required field was left empty.', status: 400 };
    case '22P02':
    case '22003':
      return { message: 'One of those values was the wrong type or out of range.', status: 400 };
    case '42501':
      return { message: 'The database refused that write — a row-level security policy blocked it.', status: 403 };
    case 'PGRST116':
      return { message: 'Not found.', status: 404 };
    default:
      return null;
  }
}
