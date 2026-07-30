import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';

export class AppError extends Error {
  statusCode: number;
  code?: string;

  constructor(message: string, statusCode: number, code?: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
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
    res.status(err.statusCode).json({ error: err.message, ...(err.code ? { code: err.code } : {}) });
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

  res.status(500).json({ error: 'Internal server error' });
}
