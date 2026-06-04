// Phase 19 GST / R2 migration — real Cloudflare R2 PDF storage provider.
//
// Replaces the reserved-but-unimplemented 's3' branch (the old S3 adapter
// had no PUT support). R2 speaks the S3 API and supports PUT, so tax-document
// PDFs are written server-side via R2Adapter.putObject and served via a
// short-lived presigned GET URL. Selected with TAX_PDF_STORAGE_PROVIDER=r2.
import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { R2Adapter } from '../../../../integrations/r2/adapters/r2.adapter';
import type {
  PdfSignedUrlInput,
  PdfUploadInput,
  PdfUploadResult,
  TaxPdfStorageProvider,
} from './tax-pdf-storage.provider';

@Injectable()
export class R2TaxPdfStorageProvider implements TaxPdfStorageProvider {
  private readonly logger = new Logger(R2TaxPdfStorageProvider.name);
  readonly name = 'r2';

  constructor(private readonly r2: R2Adapter) {}

  /** Namespace tax PDFs under a stable prefix in the bucket. */
  private keyFor(storagePath: string): string {
    return `tax-pdfs/${storagePath}`;
  }

  async upload(input: PdfUploadInput): Promise<PdfUploadResult> {
    const key = this.keyFor(input.storagePath);
    await this.r2.putObject(key, input.body, input.contentType);
    const sha256 = createHash('sha256').update(input.body).digest('hex');
    const publicUrl = await this.r2.createAccessUrl({ key, expiresInSeconds: 300 });
    this.logger.log(
      `[r2] tax PDF written: ${input.storagePath} (${input.body.length} bytes, sha256=${sha256.slice(0, 12)}...)`,
    );
    return {
      storagePath: input.storagePath,
      publicUrl,
      sha256,
      provider: this.name,
    };
  }

  async createSignedUrl(input: PdfSignedUrlInput): Promise<string> {
    return this.r2.createAccessUrl({
      key: this.keyFor(input.storagePath),
      expiresInSeconds: input.expiresInSeconds ?? 300,
    });
  }
}
