import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { EnvService } from '../../bootstrap/env/env.service';
import { AppLoggerService } from '../../bootstrap/logging/app-logger.service';
import { R2Client } from '../r2/clients/r2.client';

export interface MediaUploadOptions {
  folder: string;
  resourceType?: string;
  /** Accepted for back-compat; ignored by the R2 backend. */
  transformation?: Record<string, unknown>[];
}

export interface MediaUploadResult {
  secureUrl: string;
  publicId: string;
  format: string;
  width: number;
  height: number;
  bytes: number;
}

/**
 * Media storage adapter — Cloudflare R2 (object storage) + sharp (image
 * normalisation). This is the platform's ONLY media backend; the former
 * Cloudinary path has been fully removed.
 *
 * When R2 is usable (creds + a public delivery base) uploads/deletes/URLs
 * route to R2. When it isn't: dev/test get a deterministic dev-stub
 * placeholder so upload-dependent flows (KYC, branding, evidence) stay
 * testable locally, and production throws loudly — a misconfigured prod is
 * a real bug, not a UX papercut.
 */
@Injectable()
export class MediaStorageAdapter {
  private r2PublicBase = '';

  constructor(
    private readonly envService: EnvService,
    private readonly logger: AppLoggerService,
    private readonly r2: R2Client,
  ) {
    this.logger.setContext('MediaStorageAdapter');
    this.r2PublicBase = (this.envService.getOptional('R2_PUBLIC_BASE_URL') || '').replace(/\/+$/, '');
  }

  /**
   * R2 is usable only when configured (creds) AND a public delivery base is
   * set (so PUBLIC assets resolve). Until then uploads fall back to the
   * dev-stub (dev/test) or throw (prod).
   */
  private useR2(): boolean {
    return this.r2.isConfigured && !!this.r2PublicBase;
  }

  /** Provider tag persisted on FileMetadata (drives getSecureUrl / delete routing). */
  get providerTag(): 'r2' {
    return 'r2';
  }

  async upload(
    fileBuffer: Buffer,
    options: MediaUploadOptions,
  ): Promise<MediaUploadResult> {
    if (this.useR2()) {
      return this.uploadViaR2(fileBuffer, options);
    }
    // R2 not (fully) configured. Phase 250 (#6) — the dev-stub must NOT
    // fire in staging/preprod (or when NODE_ENV is unset): a deploy that
    // lost its storage creds must fail loudly, not "succeed" with fake
    // assets that look real in UAT. Restrict to dev/test only.
    const env = (this.envService.getOptional('NODE_ENV') || '').toLowerCase();
    const allowStub = env === 'development' || env === 'test';
    if (allowStub) {
      const id = randomUUID();
      const publicId = `dev-stub/${options.folder.replace(/\//g, '_')}/${id}`;
      const secureUrl =
        `https://placehold.co/600x400/eef2ff/4338ca` +
        `?text=DEV+STUB+${encodeURIComponent(options.folder)}`;
      this.logger.warn(
        `Media storage (R2) not configured — returning dev-stub URL ` +
        `(publicId=${publicId}, bytes=${fileBuffer.length})`,
      );
      return {
        secureUrl,
        publicId,
        format: 'png',
        width: 600,
        height: 400,
        bytes: fileBuffer.length,
      };
    }
    throw new Error(
      'Media storage (Cloudflare R2) is not configured. Set R2_ACCOUNT_ID, ' +
        'R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_PUBLIC_BASE_URL.',
    );
  }

  /**
   * Canonical public delivery URL for an asset already in R2 (publicId is
   * the R2 key). Used when we hold a key in `storageKey` / `providerFileId`
   * but didn't store the URL upfront — i.e. PRIVATE-classified files we
   * surface only via an authenticated server endpoint.
   *
   * Cloudflare edge image-resizing, if enabled on the zone, applies via the
   * `cdn-cgi/image/` path prefix — the delivery-optimisation follow-up; the
   * raw URL works now.
   */
  urlFor(publicId: string, _opts?: { resourceType?: 'image' | 'video' | 'raw' }): string {
    if (this.useR2()) {
      return this.r2PublicBase ? `${this.r2PublicBase}/${publicId}` : '';
    }
    return '';
  }

  /**
   * Delete that REPORTS its outcome instead of swallowing. Callers
   * (soft-delete, retention, orphan sweep) need to know whether the bytes
   * are actually gone before they drop the DB row / mark erased.
   *  - `{ ok: true }`          — destroyed, or already absent (idempotent).
   *  - `{ ok: false, reason }` — a real failure; caller keeps the row for retry.
   * dev-stub publicIds are a no-op success (they never reached storage).
   */
  async deleteAsset(
    publicId: string,
    _opts?: { resourceType?: 'image' | 'video' | 'raw' },
  ): Promise<{ ok: boolean; reason?: string }> {
    if (!publicId) return { ok: true };
    if (publicId.startsWith('dev-stub/')) return { ok: true };
    if (this.useR2()) {
      try {
        await this.r2.deleteObject(publicId);
        return { ok: true };
      } catch (e: any) {
        return { ok: false, reason: e?.message ?? 'error' };
      }
    }
    this.logger.warn('Media storage (R2) not configured — skipping delete');
    return { ok: false, reason: 'not_configured' };
  }

  /** Back-compat void wrapper for existing callers (orphan sweep, etc.). */
  async delete(publicId: string): Promise<void> {
    await this.deleteAsset(publicId);
  }

  // ── R2 (+ sharp) backend ─────────────────────────────────────────

  /**
   * Upload to R2. For images, sharp auto-orients (applying EXIF rotation)
   * then re-encodes — which STRIPS EXIF/GPS at rest and yields real
   * dimensions. Non-images (PDF/video) are stored as-is with a sniffed
   * content-type so the browser renders them.
   */
  private async uploadViaR2(
    buffer: Buffer,
    options: MediaUploadOptions,
  ): Promise<MediaUploadResult> {
    let body = buffer;
    let width = 0;
    let height = 0;
    let format = 'bin';
    let contentType = 'application/octet-stream';

    const wantsImage = (options.resourceType ?? 'image') === 'image';
    let processedImage = false;
    if (wantsImage) {
      try {
        const { data, info } = await sharp(buffer).rotate().toBuffer({ resolveWithObject: true });
        body = data;
        width = info.width ?? 0;
        height = info.height ?? 0;
        format = info.format ?? 'bin';
        contentType = format === 'jpg' ? 'image/jpeg' : `image/${format}`;
        processedImage = true;
      } catch {
        // Not a decodable image — fall through to raw + content sniff.
      }
    }
    if (!processedImage) {
      const sniff = this.sniffContentType(buffer);
      contentType = sniff.contentType;
      format = sniff.ext;
    }

    const key = this.r2.generateKey(options.folder, `media.${format}`);
    await this.r2.putObject(key, body, contentType);
    return {
      secureUrl: this.r2PublicBase ? `${this.r2PublicBase}/${key}` : '',
      publicId: key,
      format,
      width,
      height,
      bytes: body.length,
    };
  }

  /** Minimal content-type/extension sniff for non-image uploads (PDF/video). */
  private sniffContentType(buf: Buffer): { contentType: string; ext: string } {
    if (buf.length >= 4) {
      if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) {
        return { contentType: 'application/pdf', ext: 'pdf' };
      }
      if (
        buf.length >= 8 &&
        buf[4] === 0x66 &&
        buf[5] === 0x74 &&
        buf[6] === 0x79 &&
        buf[7] === 0x70
      ) {
        return { contentType: 'video/mp4', ext: 'mp4' };
      }
    }
    return { contentType: 'application/octet-stream', ext: 'bin' };
  }
}
