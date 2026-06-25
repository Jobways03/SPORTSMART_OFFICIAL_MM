// Phase 19 GST — Stub PDF storage provider.
//
// Writes the rendered bytes to the local filesystem under
// `apps/api/storage/tax-pdfs/...`. Returns a `file://` URL for
// `publicUrl` so dev tooling can open the file directly.
//
// The stub stays the dev/test default. The real path is now Cloudflare R2
// (R2TaxPdfStorageProvider, TAX_PDF_STORAGE_PROVIDER=r2) — R2 speaks the S3
// API and supports PUT. MediaStorageAdapter is image-only (`allowed_formats:
// ['jpg','jpeg','png','webp']`) so it can't hold PDFs. The provider contract
// is identical regardless; flipping the env only swaps the adapter.
//
// In dev the URL renders as `file:///abs/path/...pdf`. Tests
// configure an in-memory FS via the StubTaxPdfStorageProvider's
// constructor injection of a custom write/read pair.

import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import { dirname, join } from 'path';
import { defaultStubTaxPdfDir } from './tax-pdf-storage.provider';
import type {
  PdfSignedUrlInput,
  PdfUploadInput,
  PdfUploadResult,
  TaxPdfStorageProvider,
} from './tax-pdf-storage.provider';

export interface StubFsAdapter {
  mkdir(path: string): Promise<void>;
  writeFile(path: string, body: Buffer): Promise<void>;
  fileExists(path: string): Promise<boolean>;
}

const defaultFs: StubFsAdapter = {
  mkdir: async (path: string) => {
    await fs.mkdir(path, { recursive: true });
  },
  writeFile: async (path: string, body: Buffer) => {
    await fs.writeFile(path, body);
  },
  fileExists: async (path: string) => {
    try {
      await fs.access(path);
      return true;
    } catch {
      return false;
    }
  },
};

@Injectable()
export class StubTaxPdfStorageProvider implements TaxPdfStorageProvider {
  private readonly logger = new Logger(StubTaxPdfStorageProvider.name);
  readonly name = 'stub';
  /** Override-able for tests + ops who want a non-default storage dir. */
  private readonly rootDir: string;
  /** Base URL the API is reachable at, so download links are HTTP (a
   *  browser can't open the `file://` path the stub stores to). */
  private readonly publicBaseUrl: string;

  constructor(
    rootDir?: string,
    private readonly fsAdapter: StubFsAdapter = defaultFs,
  ) {
    this.rootDir = rootDir ?? defaultStubTaxPdfDir();
    // Public base for the tax-PDF download route. Prefer an explicit
    // TAX_PDF_PUBLIC_BASE_URL / PUBLIC_API_BASE_URL, then fall back to APP_URL
    // (the API's public URL, set per-environment) — NOT localhost, which leaks
    // `http://localhost:<PORT>` into the invoice download link and refuses to
    // connect from a browser. localhost is only the local-dev last resort.
    this.publicBaseUrl =
      process.env.TAX_PDF_PUBLIC_BASE_URL ||
      process.env.PUBLIC_API_BASE_URL ||
      process.env.APP_URL ||
      `http://localhost:${process.env.PORT || '8000'}`;
  }

  /** HTTP URL served by TaxPdfFileController (base64url-encoded path). */
  private fileUrl(storagePath: string): string {
    const token = Buffer.from(storagePath, 'utf-8').toString('base64url');
    return `${this.publicBaseUrl}/api/v1/tax-pdfs/file/${token}`;
  }

  async upload(input: PdfUploadInput): Promise<PdfUploadResult> {
    const absPath = join(this.rootDir, input.storagePath);
    await this.fsAdapter.mkdir(dirname(absPath));
    await this.fsAdapter.writeFile(absPath, input.body);
    const sha256 = createHash('sha256').update(input.body).digest('hex');
    this.logger.log(
      `[stub] PDF written: ${input.storagePath} (${input.body.length} bytes, sha256=${sha256.slice(0, 12)}...)`,
    );
    return {
      storagePath: input.storagePath,
      publicUrl: this.fileUrl(input.storagePath),
      sha256,
      provider: this.name,
    };
  }

  async createSignedUrl(input: PdfSignedUrlInput): Promise<string> {
    // The stub doesn't truly sign — it serves the file over HTTP via
    // TaxPdfFileController. The signed-URL semantics (expiry,
    // query-string auth) only matter for a real cloud adapter. We append
    // a synthetic ?expires=... query so callers don't cache it forever.
    const expiresInSeconds = input.expiresInSeconds ?? 300;
    const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;
    return `${this.fileUrl(input.storagePath)}?expires=${expiresAt}`;
  }
}
