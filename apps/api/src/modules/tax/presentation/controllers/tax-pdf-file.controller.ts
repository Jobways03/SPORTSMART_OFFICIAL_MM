import { Controller, Get, Logger, Param, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { resolve, sep } from 'path';

/**
 * Dev-only static serve for stub-stored tax-document PDFs.
 *
 * The StubTaxPdfStorageProvider writes rendered invoices to the local
 * filesystem under `storage/tax-pdfs/...`. A browser can't open the
 * `file://` paths a naive stub would hand out ("Not allowed to load
 * local resource"), so the stub now points its public/signed URLs at
 * this route, which streams the file over HTTP.
 *
 * The download URL is issued (scope-checked + audited) by
 * TaxDocumentDownloadService before it ever reaches a client, so the
 * encoded path here acts as the access token — same model as a cloud
 * signed URL. In production TAX_PDF_STORAGE_PROVIDER points at
 * S3/media (served by the cloud directly) and this route is unused.
 *
 * The `:token` is the base64url-encoded storage path (avoids a wildcard
 * route, so it's resolver-version agnostic).
 */
@ApiTags('Tax / Documents')
@Controller('tax-pdfs')
export class TaxPdfFileController {
  private readonly logger = new Logger(TaxPdfFileController.name);
  private readonly rootDir = resolve(process.cwd(), 'storage', 'tax-pdfs');

  @Get('file/:token')
  serve(@Param('token') token: string, @Res() res: Response): void {
    let storagePath: string;
    try {
      storagePath = Buffer.from(token, 'base64url').toString('utf-8');
    } catch {
      res.status(400).send('Bad token');
      return;
    }
    const abs = resolve(this.rootDir, storagePath);
    // Path-traversal guard: the resolved path must stay under rootDir.
    if (abs !== this.rootDir && !abs.startsWith(this.rootDir + sep)) {
      res.status(400).send('Bad path');
      return;
    }
    res.sendFile(abs, (err) => {
      if (err && !res.headersSent) {
        this.logger.warn(`tax-pdf serve miss: ${storagePath}`);
        res.status(404).send('Not found');
      }
    });
  }
}
