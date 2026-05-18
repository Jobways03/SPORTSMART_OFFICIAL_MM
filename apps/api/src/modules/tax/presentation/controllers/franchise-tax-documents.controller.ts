// Phase 25 GST — Franchise-facing tax document API.
//
// Franchises see invoices for sales their fulfilment node served. Tax
// documents for FRANCHISE supplier rows are written with `sellerId=null`
// (the franchise lives on the linked SubOrder), so the filter has to
// hop through `subOrder.franchiseId` rather than the simpler sellerId
// equality the seller controller uses. Future migration to put the
// franchise's id into `sellerId` would let us collapse this back to
// the seller pattern; the data-model decision predates this controller.

import {
  Controller,
  Get,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { FranchiseAuthGuard } from '../../../../core/guards';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { TaxDocumentDownloadService } from '../../application/services/tax-document-download.service';
import { mapDownloadError } from './customer-tax-documents.controller';

@ApiTags('Franchise / Tax Documents')
@Controller('franchise/tax-documents')
@UseGuards(FranchiseAuthGuard)
export class FranchiseTaxDocumentsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly download: TaxDocumentDownloadService,
  ) {}

  @Get()
  async list(
    @Req() req: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('documentType') documentType?: string,
    @Query('financialYear') financialYear?: string,
    @Query('orderId') orderId?: string,
    @Query('subOrderId') subOrderId?: string,
  ) {
    const safePage = Math.max(1, parseInt(page ?? '1', 10) || 1);
    const safeLimit = Math.min(50, Math.max(1, parseInt(limit ?? '20', 10) || 20));
    const franchiseId: string = req.franchiseId;

    // TaxDocument has no Prisma relation to SubOrder by design (cross-
    // module FK ban — see comment block at the top of tax-documents.prisma).
    // So we pre-resolve the franchise's sub-order ids and use them in an
    // `in` filter. We also accept the (legacy / theoretical) sellerId-
    // equals-franchiseId path so a future backfill that populates
    // sellerId for FRANCHISE supplier docs continues to work.
    const franchiseSubOrders = await this.prisma.subOrder.findMany({
      where: { franchiseId },
      select: { id: true },
    });
    const franchiseSubOrderIds = franchiseSubOrders.map((s) => s.id);

    const where: any = {
      OR: [
        { sellerId: franchiseId },
        { subOrderId: { in: franchiseSubOrderIds } },
      ],
      status: { notIn: ['VOIDED_DRAFT', 'SUPERSEDED'] },
    };
    if (documentType) where.documentType = documentType;
    if (financialYear) where.financialYear = financialYear;
    if (subOrderId) {
      // When the caller pre-filters to one sub-order, require it to be
      // theirs — otherwise the OR clause above would still leak siblings.
      if (!franchiseSubOrderIds.includes(subOrderId)) {
        return {
          success: true,
          message: 'Tax documents retrieved',
          data: { items: [], pagination: { page: safePage, limit: safeLimit, total: 0, totalPages: 0 } },
        };
      }
      where.subOrderId = subOrderId;
      delete where.OR;
    }
    if (orderId) where.masterOrderId = orderId;

    const [items, total] = await Promise.all([
      this.prisma.taxDocument.findMany({
        where,
        select: {
          id: true,
          documentNumber: true,
          documentType: true,
          financialYear: true,
          generatedAt: true,
          status: true,
          einvoiceStatus: true,
          irn: true,
          documentTotalInPaise: true,
          taxableAmountInPaise: true,
          totalTaxAmountInPaise: true,
          buyerGstin: true,
          buyerLegalName: true,
        },
        orderBy: { generatedAt: 'desc' },
        skip: (safePage - 1) * safeLimit,
        take: safeLimit,
      }),
      this.prisma.taxDocument.count({ where }),
    ]);

    return {
      success: true,
      message: 'Tax documents retrieved',
      data: {
        items: items.map((d) => ({
          id: d.id,
          documentNumber: d.documentNumber,
          documentType: d.documentType,
          financialYear: d.financialYear,
          generatedAt: d.generatedAt,
          status: d.status,
          einvoiceStatus: d.einvoiceStatus,
          irn: d.irn,
          documentTotalInPaise: d.documentTotalInPaise?.toString() ?? '0',
          taxableAmountInPaise: d.taxableAmountInPaise?.toString() ?? '0',
          totalTaxAmountInPaise: d.totalTaxAmountInPaise?.toString() ?? '0',
          buyerGstin: d.buyerGstin,
          buyerLegalName: d.buyerLegalName,
        })),
        pagination: {
          page: safePage,
          limit: safeLimit,
          total,
          totalPages: Math.ceil(total / safeLimit),
        },
      },
    };
  }

  @Get(':id/download')
  async download_(
    @Req() req: any,
    @Param('id') id: string,
    @Query('expiresInSeconds') expiresInSeconds?: string,
  ) {
    try {
      const ttl = expiresInSeconds ? parseInt(expiresInSeconds, 10) : undefined;
      const result = await this.download.issueDownloadUrl({
        documentId: id,
        actor: {
          type: 'FRANCHISE',
          id: req.franchiseId,
          ip: req.ip ?? null,
          userAgent: req.headers?.['user-agent'] ?? null,
        },
        expiresInSeconds:
          ttl && Number.isFinite(ttl) && ttl >= 30 && ttl <= 3600
            ? ttl
            : undefined,
      });
      return { success: true, message: 'Download URL issued', data: result };
    } catch (err) {
      throw mapDownloadError(err);
    }
  }
}
