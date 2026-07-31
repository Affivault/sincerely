/**
 * Throwaway TLS material for the linkedin.com stub.
 *
 * Generated on demand into a gitignored directory rather than committed: a
 * private key in a repository is a bad habit even when it is worthless, and
 * secret scanners are right to complain about it.
 *
 * The cert is never trusted system-wide. Chromium is launched with
 * --ignore-certificate-errors-spki-list pinned to *this* key's fingerprint, so
 * only this one certificate is accepted, and only by the throwaway browser
 * profile the tests create. That matters: blanket --ignore-certificate-errors
 * marks the page insecure, and Chrome will not inject content scripts into an
 * insecure page — which is precisely what the LinkedIn suite needs it to do.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const DIR = join(here, '.tls');
const KEY = join(DIR, 'key.pem');
const CERT = join(DIR, 'cert.pem');

/**
 * @returns {Promise<{key: Buffer, cert: Buffer, spki: string}>}
 *   `spki` is the base64 SHA-256 of the public key info, in the form Chromium's
 *   --ignore-certificate-errors-spki-list expects.
 */
export async function ensureCert() {
  if (!existsSync(KEY) || !existsSync(CERT)) {
    mkdirSync(DIR, { recursive: true });
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', KEY,
      '-out', CERT,
      '-days', '365',
      '-subj', '/CN=www.linkedin.com',
      '-addext', 'subjectAltName=DNS:www.linkedin.com,DNS:linkedin.com',
    ], { stdio: 'ignore' });
  }

  return { key: readFileSync(KEY), cert: readFileSync(CERT), spki: spkiFingerprint() };
}

/** The pin Chromium needs, derived from the cert rather than hardcoded. */
export function spkiFingerprint() {
  const pubkey = execFileSync('openssl', ['x509', '-in', CERT, '-pubkey', '-noout']);
  const der = execFileSync('openssl', ['pkey', '-pubin', '-outform', 'der'], { input: pubkey });
  const digest = execFileSync('openssl', ['dgst', '-sha256', '-binary'], { input: der });
  return execFileSync('openssl', ['enc', '-base64'], { input: digest }).toString().trim();
}
