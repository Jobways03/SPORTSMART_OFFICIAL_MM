// Phase 160 (§52 TCS lifecycle audit B2 / #2) — Seller-facing TCS API.
//
// Before this controller, a seller's TCS experience was: their settlement
// payout arrived short by the TCS amount, with no way to see the
// deduction, the filing status, or download a §52(5) certificate. That
// blocked the seller's GSTR-2A reconciliation entirely.
//
// Every endpoint is scoped to the authenticated seller (`req.sellerId`,
// set by SellerAuthGuard). The certificate-download endpoint additionally
// re-checks ownership on the specific ledger row (defence in depth) and
// only serves rows that have actually reached CERTIFICATE_ISSUED — a
// seller can never pull a draft preview or another seller's document.

import {
  Controller,
  ForbiddenException,
  Get,
  Header,
  HttpException,
  HttpStatus,
  NotFoundException,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { SellerAuthGuard } from '../../../../core/guards';
import { TcsService } from '../../application/services/tcs.service';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';

@ApiTags('Seller / Tax — TCS (Section 52)')
@Controller('seller/tax/tcs')
@UseGuards(SellerAuthGuard)
export class SellerTcsController {
  constructor(
    private readonly tcs: TcsService,
    private readonly audit: AuditPublicFacade,
  ) {}

  /**
   * The seller's own TCS rows. Optional ?filingPeriod=YYYY-MM filter;
   * otherwise the most recent rows first. Money fields are serialised as
   * decimal strings (BigInt-safe). Lifecycle status lets the seller see
   * "has the marketplace filed / paid / certified my TCS this month".
   */
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Get('summary')
  async summary(
    @Req() req: any,
    @Query('filingPeriod') filingPeriod?: string,
  ) {
    if (filingPeriod && !/^\d{4}-\d{2}$/.test(filingPeriod)) {
      throw new HttpException(
        {
          success: false,
          code: 'INVALID_REQUEST',
          message: 'filingPeriod must be YYYY-MM',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    const rows = await this.tcs.listForSeller({
      sellerId: req.sellerId,
      filingPeriod: filingPeriod || undefined,
    });
    return {
      success: true,
      message: 'TCS summary retrieved',
      data: {
        filingPeriod: filingPeriod ?? null,
        items: rows.map((r) => this.toSellerView(r)),
      },
    };
  }

  /**
   * The seller's issued §52(5) certificates (CERTIFICATE_ISSUED rows
   * only). Each carries a download link to the HTML certificate.
   */
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Get('certificates')
  async certificates(@Req() req: any) {
    const rows = await this.tcs.listForSeller({
      sellerId: req.sellerId,
      limit: 120,
    });
    const issued = rows.filter((r) => r.status === 'CERTIFICATE_ISSUED');
    return {
      success: true,
      message: 'TCS certificates retrieved',
      data: {
        items: issued.map((r) => ({
          ...this.toSellerView(r),
          certificateNumber: r.certificateNumber,
          certificateIssuedAt: r.certificateIssuedAt,
          downloadUrl: `/seller/tax/tcs/certificates/${r.id}.html`,
        })),
      },
    };
  }

  /**
   * Download the seller's own §52(5) certificate as HTML. Three guards:
   *   - 404 when the ledger row doesn't exist;
   *   - 403 when the row belongs to a different seller (cross-seller
   *     leak prevention — the most important check here);
   *   - 404 when the row hasn't reached CERTIFICATE_ISSUED (a seller
   *     can't pull a draft preview; only the admin preview endpoint can).
   * Audited per download.
   */
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get('certificates/:ledgerId.html')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async downloadCertificate(
    @Req() req: any,
    @Res() res: Response,
    @Param('ledgerId') ledgerId: string,
  ) {
    const owner = await this.tcs.getLedgerOwner(ledgerId);
    if (!owner) {
      throw new NotFoundException({
        success: false,
        code: 'NOT_FOUND',
        message: 'TCS certificate not found',
      });
    }
    if (owner.sellerId !== req.sellerId) {
      // Do not reveal existence detail — same 403 a stranger would get.
      throw new ForbiddenException({
        success: false,
        code: 'FORBIDDEN',
        message: 'You do not have access to this certificate',
      });
    }
    if (owner.status !== 'CERTIFICATE_ISSUED') {
      throw new NotFoundException({
        success: false,
        code: 'CERTIFICATE_NOT_ISSUED',
        message:
          'No certificate is available for this period yet — the operator ' +
          'has not finished filing / certifying TCS.',
      });
    }
    const html = await this.tcs.renderCertificateHtml(ledgerId);
    if (!html) {
      throw new NotFoundException({
        success: false,
        code: 'NOT_FOUND',
        message: 'TCS certificate not found',
      });
    }
    try {
      await this.audit.writeAuditLog({
        actorId: req.sellerId,
        actorRole: 'SELLER',
        action: 'tax.tcs.certificateDownloaded',
        module: 'tax',
        resource: 'gst_tcs_settlement_ledger',
        resourceId: ledgerId,
        metadata: { byteSize: Buffer.byteLength(html, 'utf8') },
        ipAddress: req?.ip ?? req?.headers?.['x-forwarded-for'] ?? null,
        userAgent: req?.headers?.['user-agent'] ?? null,
      });
    } catch {
      // never fail the download on an audit-write blip
    }
    res.send(html);
  }

  /** BigInt → decimal-string projection of the seller-visible fields. */
  private toSellerView(r: {
    id: string;
    filingPeriod: string;
    status: string;
    supplierGstin: string | null;
    grossTaxableSupplyInPaise: bigint;
    netTaxableSupplyInPaise: bigint;
    cgstTcsInPaise: bigint;
    sgstTcsInPaise: bigint;
    igstTcsInPaise: bigint;
    totalTcsInPaise: bigint;
    tcsRateBps: number;
    nicArn: string | null;
    certificateNumber: string | null;
    computedAt: Date;
  }) {
    return {
      id: r.id,
      filingPeriod: r.filingPeriod,
      status: r.status,
      supplierGstin: r.supplierGstin,
      grossTaxableSupplyInPaise: r.grossTaxableSupplyInPaise.toString(),
      netTaxableSupplyInPaise: r.netTaxableSupplyInPaise.toString(),
      cgstTcsInPaise: r.cgstTcsInPaise.toString(),
      sgstTcsInPaise: r.sgstTcsInPaise.toString(),
      igstTcsInPaise: r.igstTcsInPaise.toString(),
      totalTcsInPaise: r.totalTcsInPaise.toString(),
      tcsRateBps: r.tcsRateBps,
      nicArn: r.nicArn,
      certificateNumber: r.certificateNumber,
      computedAt: r.computedAt,
    };
  }
}
