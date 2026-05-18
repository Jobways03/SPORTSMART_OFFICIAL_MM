// Phase 25 GST — Seller-facing tax document API.
//
// Sellers see invoices THEY issued (`sellerId = req.sellerId`). Same
// scope-protection pattern as the customer controller — the service
// layer enforces, the controller threads auth.

import {
  Controller,
  Get,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SellerAuthGuard } from '../../../../core/guards';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { TaxDocumentDownloadService } from '../../application/services/tax-document-download.service';
import { mapDownloadError } from './customer-tax-documents.controller';

@ApiTags('Seller / Tax Documents')
@Controller('seller/tax-documents')
@UseGuards(SellerAuthGuard)
export class SellerTaxDocumentsController {
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
    const where: any = {
      sellerId: req.sellerId,
      status: { notIn: ['VOIDED_DRAFT', 'SUPERSEDED'] },
    };
    if (documentType) where.documentType = documentType;
    if (financialYear) where.financialYear = financialYear;
    if (subOrderId) where.subOrderId = subOrderId;
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
          type: 'SELLER',
          id: req.sellerId,
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
