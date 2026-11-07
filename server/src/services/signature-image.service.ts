import { randomUUID } from 'crypto';
import { supabaseAdmin } from '../config/supabase.js';
import { env } from '../config/env.js';
import { AppError } from '../middleware/error.middleware.js';

/* ═══════════════════════════════════════════════════════════════════════
   Images for email signatures (migration 117).

   A signature image has to live at a public https address: Gmail and
   Outlook drop images pasted into the HTML itself. Most people do not have
   anywhere to put a logo, so the app keeps it and serves it.
   ═══════════════════════════════════════════════════════════════════════ */

/** Big enough for a crisp 2x logo or headshot; small enough to load fast in an inbox. */
export const SIGNATURE_IMAGE_MAX_BYTES = 400 * 1024;

const TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

/** Read a data: URL into its type and bytes, refusing anything but a small image. */
export function parseImageDataUrl(dataUrl: unknown): { mime: string; bytes: Buffer } {
  const m = /^data:(image\/[a-z+]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(String(dataUrl || ''));
  if (!m) throw new AppError('Send the image as a PNG, JPG, GIF or WebP file', 400);
  const mime = m[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : m[1].toLowerCase();
  if (!TYPES[mime]) throw new AppError('Use a PNG, JPG, GIF or WebP image. SVG is not shown by Gmail or Outlook.', 400);
  const bytes = Buffer.from(m[2].replace(/\s+/g, ''), 'base64');
  if (bytes.length === 0) throw new AppError('That image is empty', 400);
  if (bytes.length > SIGNATURE_IMAGE_MAX_BYTES) {
    throw new AppError(`That image is ${Math.ceil(bytes.length / 1024)} KB. Keep signature images under ${SIGNATURE_IMAGE_MAX_BYTES / 1024} KB so they load quickly.`, 413);
  }
  return { mime, bytes };
}

export function signatureImageUrl(id: string, mime: string): string {
  return `${env.API_BASE_URL.replace(/\/+$/, '')}/api/sig/${id}.${TYPES[mime] || 'png'}`;
}

function missingTable(message: string | undefined): boolean {
  return /signature_images/.test(message || '') && /(does not exist|schema cache|Could not find)/i.test(message || '');
}

export const signatureImageService = {
  async upload(userId: string, dataUrl: unknown): Promise<{ id: string; url: string }> {
    const { mime, bytes } = parseImageDataUrl(dataUrl);
    const id = randomUUID();
    const { error } = await supabaseAdmin.from('signature_images').insert({
      id,
      user_id: userId,
      mime,
      size_bytes: bytes.length,
      data_base64: bytes.toString('base64'),
    });
    if (error) {
      if (missingTable(error.message)) {
        throw new AppError('Image upload needs database update 117. Paste the image’s web address instead for now.', 503);
      }
      throw new AppError(error.message, 500);
    }
    return { id, url: signatureImageUrl(id, mime) };
  },

  /** For the public address. Null when there is no such image. */
  async get(id: string): Promise<{ mime: string; bytes: Buffer } | null> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const { data, error } = await supabaseAdmin
      .from('signature_images')
      .select('mime, data_base64')
      .eq('id', id)
      .maybeSingle();
    if (error || !data) return null;
    return { mime: (data as any).mime, bytes: Buffer.from((data as any).data_base64, 'base64') };
  },
};
