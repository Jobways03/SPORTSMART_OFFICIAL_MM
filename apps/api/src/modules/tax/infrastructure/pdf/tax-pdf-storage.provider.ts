// Phase 19 GST — Tax-document PDF storage provider interface.
//
// Abstracts the upload target so the renderer can swap between:
//   - StubTaxPdfStorageProvider (default in dev/test) — writes to the
//     local filesystem, returns a stable file:// URL.
//   - S3 / Cloudinary adapter (later phase) — same contract.
//
// Selection is via env (`TAX_PDF_STORAGE_PROVIDER`) — choice is
// boot-time, not service-layer.

export interface PdfUploadInput {
  /** Logical key — `tax-documents/${fy}/${supplierGstin|PLATFORM}/${documentNumber}.pdf`. */
  storagePath: string;
  /** Rendered PDF bytes. The stub may accept HTML buffers; real adapters
   *  require true PDF bytes. */
  body: Buffer;
  /** Content type — typically `application/pdf`. The stub records this
   *  on disk in a sidecar so a dev can sanity-check. */
  contentType: string;
}

export interface PdfUploadResult {
  storagePath: string;
  /** Stable URL (signed or not) where the file lives. For the stub
   *  this is a `file://` path. For S3 this is a presigned GET URL. */
  publicUrl: string;
  /** SHA-256 hex of the bytes written. The retry path treats a
   *  digest mismatch as upload corruption + retries. */
  sha256: string;
  /** Provider attribution. Persisted on tax_documents.pdf_provider. */
  provider: string;
}

export interface PdfSignedUrlInput {
  storagePath: string;
  /** Default 300 seconds. The stub ignores this; the real adapter
   *  produces a presigned URL with this expiry. */
  expiresInSeconds?: number;
}

export interface TaxPdfStorageProvider {
  readonly name: string;
  upload(input: PdfUploadInput): Promise<PdfUploadResult>;
  /** Generate a download URL valid for `expiresInSeconds`. Idempotent
   *  — calling twice produces equivalent (possibly identical) URLs. */
  createSignedUrl(input: PdfSignedUrlInput): Promise<string>;
}

export const TAX_PDF_STORAGE_PROVIDER = Symbol.for('TaxPdfStorageProvider');
