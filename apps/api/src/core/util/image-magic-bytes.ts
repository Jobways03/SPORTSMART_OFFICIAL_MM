// Phase 97 (2026-05-23) — QC audit Gap #4 closure.
//
// Lightweight magic-byte sniffer for the QC evidence upload pipeline.
// We don't want to take an external runtime dep (`file-type`) for one
// check, so we hand-roll the four image formats we accept:
//
//   • JPEG → FF D8 FF
//   • PNG  → 89 50 4E 47 0D 0A 1A 0A
//   • GIF  → 47 49 46 38 39 61  (GIF89a) | 47 49 46 38 37 61 (GIF87a)
//   • WEBP → 52 49 46 46 .... 57 45 42 50  (RIFF....WEBP)
//
// Returns the detected MIME or null if no signature matches. Caller
// rejects the upload if the result doesn't match the user-supplied
// Content-Type — closes the "PNG header on a .exe" attack vector
// because Cloudinary's allowed_formats only validates after we've
// already transmitted.

export type DetectedImageMime =
  | 'image/jpeg'
  | 'image/png'
  | 'image/gif'
  | 'image/webp';

export function detectImageMime(buffer: Buffer): DetectedImageMime | null {
  if (!buffer || buffer.length < 12) return null;

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'image/png';
  }

  // GIF: GIF89a / GIF87a
  if (
    buffer[0] === 0x47 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x38 &&
    (buffer[4] === 0x39 || buffer[4] === 0x37) &&
    buffer[5] === 0x61
  ) {
    return 'image/gif';
  }

  // WEBP: RIFF....WEBP (the 4-byte size field sits between)
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return 'image/webp';
  }

  return null;
}

/**
 * Validate that a user-supplied buffer + claimed Content-Type pair
 * matches one of the allowed image formats by magic-byte sniffing.
 * Returns the detected mime on success; throws-friendly null on
 * mismatch.
 */
export function validateImageUpload(
  buffer: Buffer,
  claimedMime: string,
  allowedMimes: ReadonlyArray<DetectedImageMime> = [
    'image/jpeg',
    'image/png',
    'image/webp',
  ],
): { ok: true; detected: DetectedImageMime } | { ok: false; reason: string } {
  const detected = detectImageMime(buffer);
  if (!detected) {
    return {
      ok: false,
      reason: 'File does not match any allowed image format (magic-byte sniff failed)',
    };
  }
  if (!allowedMimes.includes(detected)) {
    return {
      ok: false,
      reason: `Detected ${detected} not in allowed list (${allowedMimes.join(', ')})`,
    };
  }
  // Loose claimed-mime check — many UAs send image/jpg vs image/jpeg.
  // Normalize trivially.
  const claimedNormalized = claimedMime?.toLowerCase().replace('image/jpg', 'image/jpeg');
  if (claimedNormalized && claimedNormalized !== detected) {
    return {
      ok: false,
      reason: `Content-Type (${claimedMime}) does not match detected format (${detected})`,
    };
  }
  return { ok: true, detected };
}
