// Phase 25 GST — Customer-facing tax document API.
//
// Two endpoints — list + download. Both require UserAuthGuard; the
// scope check (this customer only sees their own invoices) is enforced
// at the service layer via TaxDocumentDownloadService — the controller
// only threads the auth context.

import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { UserAuthGuard } from '../../../../core/guards';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import {
  TaxDocumentDownloadService,
  TaxDocumentDownloadDeniedError,
} from '../../application/services/tax-document-download.service';
import { PdfDocumentNotFoundError } from '../../application/services/tax-document-pdf.service';

@ApiTags('Customer / Tax Documents')
@Controller('customer/tax-documents')
@UseGuards(UserAuthGuard)
export class CustomerTaxDocumentsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly download: TaxDocumentDownloadService,
  ) {}

  /**
   * Paginated list of the authenticated customer's tax documents.
   * Returns the lightweight metadata needed for a list view —
   * NOT the line items. Use the per-document detail endpoint
   * (Phase 26) for full breakdown.
   */
  @Get()
  async list(
    @Req() req: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const safePage = Math.max(1, parseInt(page ?? '1', 10) || 1);
    const safeLimit = Math.min(50, Math.max(1, parseInt(limit ?? '20', 10) || 20));
    const skip = (safePage - 1) * safeLimit;

    const [items, total] = await Promise.all([
      this.prisma.taxDocument.findMany({
        where: {
          customerId: req.userId,
          status: { notIn: ['VOIDED_DRAFT', 'SUPERSEDED'] },
        },
        select: {
          id: true,
          documentNumber: true,
          documentType: true,
          financialYear: true,
          generatedAt: true,
          status: true,
          einvoiceStatus: true,
          documentTotalInPaise: true,
        },
        orderBy: { generatedAt: 'desc' },
        skip,
        take: safeLimit,
      }),
      this.prisma.taxDocument.count({
        where: {
          customerId: req.userId,
          status: { notIn: ['VOIDED_DRAFT', 'SUPERSEDED'] },
        },
      }),
    ]);

    return {
      success: true,
      message: 'Tax documents retrieved',
      data: {
        items: items.map(toListShape),
        pagination: {
          page: safePage,
          limit: safeLimit,
          total,
          totalPages: Math.ceil(total / safeLimit),
        },
      },
    };
  }

  /** Issue a signed download URL for one document. */
  @Get(':id/download')
  async download_(
    @Req() req: any,
    @Param('id') id: string,
    @Query('expiresInSeconds') expiresInSeconds?: string,
  ) {
    try {
      const result = await this.download.issueDownloadUrl({
        documentId: id,
        actor: {
          type: 'CUSTOMER',
          id: req.userId,
          ip: req.ip ?? null,
          userAgent: req.headers?.['user-agent'] ?? null,
        },
        expiresInSeconds: parseTtl(expiresInSeconds),
      });
      return { success: true, message: 'Download URL issued', data: result };
    } catch (err) {
      throw mapDownloadError(err);
    }
  }
}

function toListShape(d: any) {
  return {
    id: d.id,
    documentNumber: d.documentNumber,
    documentType: d.documentType,
    financialYear: d.financialYear,
    generatedAt: d.generatedAt,
    status: d.status,
    einvoiceStatus: d.einvoiceStatus,
    // Always serialise BigInt to string at the HTTP boundary.
    documentTotalInPaise: d.documentTotalInPaise?.toString() ?? '0',
  };
}

function parseTtl(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 30 || n > 3600) return undefined;
  return n;
}

/**
 * Map service-layer errors to HTTP exceptions. The download service's
 * outcomes already carry distinct error classes; the controller
 * translates them into the right status code so the frontend can
 * distinguish "not allowed" from "not yet ready" cleanly.
 */
export function mapDownloadError(err: unknown): HttpException {
  if (err instanceof PdfDocumentNotFoundError) {
    return new HttpException(
      { success: false, message: 'Document not found', code: 'NOT_FOUND' },
      HttpStatus.NOT_FOUND,
    );
  }
  if (err instanceof TaxDocumentDownloadDeniedError) {
    if (err.outcome === 'DENIED_RATE_LIMIT') {
      return new HttpException(
        {
          success: false,
          message: err.message,
          code: 'TOO_MANY_REQUESTS',
          outcome: err.outcome,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (err.outcome === 'DENIED_NOT_READY') {
      return new HttpException(
        {
          success: false,
          message: err.message,
          code: 'DOCUMENT_NOT_READY',
          outcome: err.outcome,
        },
        HttpStatus.CONFLICT,
      );
    }
    // DENIED_SCOPE / DENIED_VOIDED — return 403 so an attacker can't
    // distinguish "wrong scope" from "voided document" via the response
    // shape alone (the audit row keeps the exact outcome).
    return new HttpException(
      {
        success: false,
        message: 'Access denied',
        code: 'FORBIDDEN',
        outcome: err.outcome,
      },
      HttpStatus.FORBIDDEN,
    );
  }
  return new HttpException(
    {
      success: false,
      message: (err as Error)?.message ?? 'Download failed',
      code: 'INTERNAL_ERROR',
    },
    HttpStatus.INTERNAL_SERVER_ERROR,
  );
}
