import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { AffiliateAuthGuard } from '../../../../core/guards';
import { NotFoundAppException } from '../../../../core/exceptions';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';
import { Idempotent } from '../../../../core/decorators/idempotent.decorator';
import { CloudinaryAdapter } from '../../../../integrations/cloudinary/cloudinary.adapter';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { AffiliateRegistrationService } from '../../application/services/affiliate-registration.service';
import { AffiliateCommissionService } from '../../application/services/affiliate-commission.service';
import { AffiliateKycService } from '../../application/services/affiliate-kyc.service';
import { AffiliatePayoutService } from '../../application/services/affiliate-payout.service';
import { SubmitAffiliateKycDto } from '../dtos/affiliate-kyc.dto';
import { AddPayoutMethodDto } from '../dtos/affiliate-payout.dto';
import { AffiliateUpdateProfileDto } from '../dtos/affiliate-update-profile.dto';

const KYC_UPLOAD_MAX_BYTES = 8 * 1024 * 1024; // 8 MB — generous for high-res scans
const KYC_ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];
const KYC_KIND = ['pan', 'aadhaar'] as const;
type KycKind = (typeof KYC_KIND)[number];

const KYC_MAGIC: Record<string, number[][]> = {
  'image/jpeg': [[0xff, 0xd8, 0xff]],
  'image/png': [[0x89, 0x50, 0x4e, 0x47]],
  'image/webp': [[0x52, 0x49, 0x46, 0x46]],
};

/**
 * Affiliate self-service routes. All gated by AffiliateAuthGuard,
 * which decorates the request with `affiliateId`. Powers the portal
 * dashboard, earnings page, and commission history.
 */
@ApiTags('Affiliate Self-Service')
@Controller('affiliate/me')
@UseGuards(AffiliateAuthGuard)
export class AffiliateSelfController {
  constructor(
    private readonly registrationService: AffiliateRegistrationService,
    private readonly commissionService: AffiliateCommissionService,
    private readonly kycService: AffiliateKycService,
    private readonly payoutService: AffiliatePayoutService,
    private readonly cloudinary: CloudinaryAdapter,
    private readonly prisma: PrismaService,
    private readonly audit: AuditPublicFacade,
  ) {}

  /**
   * Affiliate-facing view of their own TDS records (Section 194H — 5%
   * deducted on commission once cumulative payouts cross the per-FY
   * threshold). One row per financial year. Mirrors the admin endpoint
   * at `/admin/affiliates/reports/tds` but locked to the requester's
   * own affiliateId so the affiliate can never see another affiliate's
   * deductions.
   *
   * Cumulative gross / TDS / net are stored in paise; we let the
   * frontend format (BigInt-safe).
   */
  @Get('tds')
  async myTds(@Req() req: Request, @Query('financialYear') financialYear?: string) {
    const affiliateId = (req as any).affiliateId;
    const where: any = { affiliateId };
    if (financialYear) where.financialYear = financialYear;

    const records = await this.prisma.affiliateTdsRecord.findMany({
      where,
      orderBy: [{ financialYear: 'desc' }],
    });

    return {
      success: true,
      message: 'TDS records fetched',
      data: { records },
    };
  }

  // Phase 159f — §194-O per-quarter tax summary (gross / TDS / status /
  // can-download-Form-16A), scoped to the requester's own affiliateId.
  @Get('tax/summary')
  async myTaxSummary(@Req() req: Request) {
    const affiliateId = (req as any).affiliateId;
    const data = await this.payoutService.getAffiliateTaxSummary(affiliateId);
    return { success: true, message: 'Tax summary fetched', data: { quarters: data } };
  }

  // Phase 159f — download the affiliate's own Form 16A for a quarter. 404 until
  // the admin has issued the certificate (status CERTIFICATE_ISSUED). Ownership
  // is enforced by AffiliateAuthGuard + the affiliateId-scoped query.
  @Get('tax/:filingPeriod/form-16a')
  async downloadForm16A(
    @Req() req: Request,
    @Param('filingPeriod') filingPeriod: string,
    @Res() res: Response,
  ) {
    const affiliateId = (req as any).affiliateId;
    const html = await this.payoutService.renderAffiliateForm16A(affiliateId, filingPeriod);
    if (!html) {
      throw new NotFoundAppException('Form 16A is not available yet for this quarter.');
    }
    const ua = req.headers['user-agent'];
    this.audit
      .writeAuditLog({
        actorId: affiliateId,
        actorRole: 'AFFILIATE',
        action: 'AFFILIATE_FORM16A_DOWNLOADED',
        module: 'affiliate',
        resource: 'AffiliateTds194OLedger',
        resourceId: filingPeriod,
        ipAddress: req.ip,
        userAgent: typeof ua === 'string' ? ua : undefined,
      })
      .catch(() => undefined);
    // Sanitise the path param before it enters a response header (CRLF / header
    // injection guard) — only safe filename chars.
    const safe = filingPeriod.replace(/[^A-Za-z0-9-]/g, '');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `inline; filename="form-16A-${safe}.html"`);
    res.send(html);
  }

  @Get()
  async getProfile(@Req() req: Request) {
    const affiliateId = (req as any).affiliateId;
    const data = await this.registrationService.getProfile(affiliateId);
    return {
      success: true,
      message: 'Profile fetched successfully',
      data,
    };
  }

  @Patch()
  @HttpCode(HttpStatus.OK)
  async updateProfile(@Req() req: Request, @Body() dto: AffiliateUpdateProfileDto) {
    const affiliateId = (req as any).affiliateId;
    const data = await this.registrationService.updateProfile({
      affiliateId,
      ...dto,
    });
    return {
      success: true,
      message: 'Profile updated successfully',
      data,
    };
  }


  @Get('balances')
  async getBalances(@Req() req: Request) {
    const affiliateId = (req as any).affiliateId;
    const data = await this.commissionService.getBalances(affiliateId);
    return {
      success: true,
      message: 'Balances fetched successfully',
      data,
    };
  }

  @Get('commissions')
  async listCommissions(
    @Req() req: Request,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
  ) {
    const affiliateId = (req as any).affiliateId;
    const data = await this.commissionService.listForAffiliate(affiliateId, {
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
      status,
    });
    return {
      success: true,
      message: 'Commissions fetched successfully',
      data,
    };
  }

  // ── KYC ─────────────────────────────────────────────────────
  // KYC endpoints temporarily disabled (commented out per product
  // request). Routes are removed from the controller; the service +
  // DTOs remain available for re-enabling. Restore by uncommenting
  // the block below and the matching frontend pieces.
  /*
  @Get('kyc')
  async getKyc(@Req() req: Request) {
    const affiliateId = (req as any).affiliateId;
    const data = await this.kycService.getMine(affiliateId);
    return {
      success: true,
      message: data ? 'KYC fetched successfully' : 'No KYC submission yet',
      data,
    };
  }

  @Post('kyc')
  @HttpCode(HttpStatus.OK)
  async submitKyc(@Req() req: Request, @Body() dto: SubmitAffiliateKycDto) {
    const affiliateId = (req as any).affiliateId;
    const data = await this.kycService.submit({
      affiliateId,
      panNumber: dto.panNumber,
      aadhaarNumber: dto.aadhaarNumber,
      panDocumentUrl: dto.panDocumentUrl,
      aadhaarDocumentUrl: dto.aadhaarDocumentUrl,
    });
    return {
      success: true,
      message: 'KYC submitted. We will review and notify you.',
      data,
    };
  }

  @Post('kyc/upload/:kind')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('document', { limits: { fileSize: KYC_UPLOAD_MAX_BYTES } }),
  )
  async uploadKycDocument(
    @Req() req: Request,
    @Param('kind') kind: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!KYC_KIND.includes(kind as KycKind)) {
      throw new BadRequestException(
        `Unsupported KYC document kind: ${kind}. Use 'pan' or 'aadhaar'.`,
      );
    }
    if (!file || !file.buffer || file.size === 0) {
      throw new BadRequestException('No file uploaded.');
    }
    if (!KYC_ALLOWED_MIME.includes(file.mimetype)) {
      throw new BadRequestException(
        'Only JPG, PNG, and WEBP images are allowed for KYC documents.',
      );
    }
    const patterns = KYC_MAGIC[file.mimetype];
    const valid = patterns?.some((pattern) =>
      pattern.every((byte, i) => file.buffer[i] === byte),
    );
    if (!valid) {
      throw new BadRequestException('Invalid or corrupted image file.');
    }

    const affiliateId = (req as any).affiliateId;
    const result = await this.cloudinary.upload(file.buffer, {
      folder: `sportsmart/affiliates/${affiliateId}/kyc/${kind}`,
      transformation: [{ width: 1600, height: 1600, crop: 'limit' }],
    });
    return {
      success: true,
      message: 'Document uploaded. Submit the form to complete KYC.',
      data: {
        kind,
        secureUrl: result.secureUrl,
        publicId: result.publicId,
        bytes: result.bytes,
      },
    };
  }
  */

  // ── Payout methods + requests ───────────────────────────────

  @Get('payout-methods')
  async listPayoutMethods(@Req() req: Request) {
    const affiliateId = (req as any).affiliateId;
    const data = await this.payoutService.listPayoutMethods(affiliateId);
    return { success: true, message: 'Payout methods fetched', data };
  }

  @Post('payout-methods')
  @HttpCode(HttpStatus.CREATED)
  async addPayoutMethod(@Req() req: Request, @Body() dto: AddPayoutMethodDto) {
    const affiliateId = (req as any).affiliateId;
    const data = await this.payoutService.addPayoutMethod({
      affiliateId,
      ...dto,
    });
    return { success: true, message: 'Payout method added', data };
  }

  @Post('payout-methods/:methodId/primary')
  @HttpCode(HttpStatus.OK)
  async setPrimary(
    @Req() req: Request,
    @Body() _: never,
    // method id comes from path — Nest's @Param works, but using Req
    // here keeps the controller's import surface tighter
  ) {
    const affiliateId = (req as any).affiliateId;
    const methodId = (req.params as any).methodId;
    const data = await this.payoutService.setPrimaryMethod(
      affiliateId,
      methodId,
    );
    return { success: true, message: 'Primary payout method updated', data };
  }

  @Get('payouts')
  async listPayouts(@Req() req: Request) {
    const affiliateId = (req as any).affiliateId;
    const data = await this.payoutService.listMyPayouts(affiliateId);
    return { success: true, message: 'Payouts fetched', data };
  }

  @Post('payouts')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Idempotent()
  async requestPayout(@Req() req: Request) {
    const affiliateId = (req as any).affiliateId;
    const data = await this.payoutService.requestPayout({
      affiliateId,
      ipAddress: req.ip,
      userAgent: req.get('user-agent') ?? undefined,
    });
    return {
      success: true,
      message: 'Payout requested. Admin will review and process the transfer.',
      data,
    };
  }
}
