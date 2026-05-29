import type { Request } from 'express';

/**
 * Phase 42 (2026-05-21) - shared image-upload helpers used by all
 * four product/variant image controllers (admin + seller x product +
 * variant). Centralizes the Multer config (fileFilter + size cap)
 * and the altText sanitizer so the four controllers stay in sync.
 */

export const ALLOWED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * Phase 42 - Gap #6 fix. Multer's fileFilter rejects non-image MIME
 * at the request-body parse stage so the file never reaches
 * controller memory.
 */
export const IMAGE_MULTER_OPTIONS = {
  limits: { fileSize: MAX_IMAGE_BYTES },
  fileFilter: (
    _req: Request,
    file: { mimetype: string },
    cb: (error: Error | null, accept: boolean) => void,
  ) => {
    const ok = (ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(file.mimetype);
    cb(null, ok);
  },
};

const HTML_TAG_PATTERN = /<[^>]*>/g;
// ASCII control characters (U+0000-U+001F and U+007F). Constructor
// form so the source file stays free of raw control bytes.
const CONTROL_CHAR_PATTERN = new RegExp('[\\u0000-\\u001F\\u007F]', 'g');

/**
 * Phase 42 - Gap #11 + #13 fix. Sanitize altText supplied with image
 * upload: strip HTML tags + ASCII control chars, trim, cap at 160.
 * Returns null on empty so the DB column stays NULL.
 */
export function sanitizeAltText(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const stripped = input
    .replace(HTML_TAG_PATTERN, '')
    .replace(CONTROL_CHAR_PATTERN, '')
    .trim();
  if (stripped.length === 0) return null;
  return stripped.slice(0, 160);
}
