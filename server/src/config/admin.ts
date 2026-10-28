/*
 * The platform owner: the only account the admin backend exists for.
 *
 * Server-side only. It used to live in the shared package, which put the
 * owner's address and the admin console's existence into every visitor's
 * JavaScript. The client now learns it is the owner from the server (the
 * billing summary says so for this account alone) and nobody else is told
 * anything.
 */
const fromEnv = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export const ADMIN_EMAILS: readonly string[] = fromEnv.length ? fromEnv : ['steven@usesincerely.com'];

export function isOwnerEmail(email: string | null | undefined): boolean {
  const clean = (email || '').trim().toLowerCase();
  return !!clean && ADMIN_EMAILS.includes(clean);
}
