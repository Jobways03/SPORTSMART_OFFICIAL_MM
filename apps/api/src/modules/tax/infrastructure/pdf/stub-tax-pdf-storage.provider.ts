// Phase 19 GST — Stub PDF storage provider.
//
// Writes the rendered bytes to the local filesystem under
// `apps/api/storage/tax-pdfs/...`. Returns a `file://` URL for
// `publicUrl` so dev tooling can open the file directly.
//
// Why the stub instead of wiring S3 / Cloudinary today:
//   1. S3Adapter is itself a stub (no PUT support yet — see
//      apps/api/src/integrations/s3/clients/s3.client.ts).
//   2. CloudinaryAdapter only accepts images (`allowed_formats:
//      ['jpg', 'jpeg', 'png', 'webp']`).
//   3. The contract on this provider is the same regardless; flipping
//      `TAX_PDF_STORAGE_PROVIDER=s3` in a later phase only swaps the
//      adapter, not the service-layer code.
//
// In dev the URL renders as `file:///abs/path/...pdf`. Tests
// configure an in-memory FS via the StubTaxPdfStorageProvider's
// constructor injection of a custom write/read pair.

import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import { dirname, join, resolve } from 'path';
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

  constructor(
    rootDir?: string,
    private readonly fsAdapter: StubFsAdapter = defaultFs,
  ) {
    this.rootDir =
      rootDir ?? resolve(process.cwd(), 'storage', 'tax-pdfs');
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
      publicUrl: `file://${absPath}`,
      sha256,
      provider: this.name,
    };
  }

  async createSignedUrl(input: PdfSignedUrlInput): Promise<string> {
    const absPath = join(this.rootDir, input.storagePath);
    // The stub doesn't sign — it just returns the file:// URL. The
    // signed-URL semantics (expiry, query-string auth) only matter
    // for a real cloud adapter. We append a synthetic ?expires=...
    // query so callers don't accidentally cache it forever.
    const expiresInSeconds = input.expiresInSeconds ?? 300;
    const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;
    return `file://${absPath}?expires=${expiresAt}`;
  }
}
