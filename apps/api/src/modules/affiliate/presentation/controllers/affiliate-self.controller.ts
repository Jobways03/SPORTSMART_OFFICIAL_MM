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
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { AffiliateAuthGuard } from '../../../../core/guards';
import { CloudinaryAdapter } from '../../../../integrations/cloudinary/cloudinary.adapter';
import { AffiliateRegistrationService } from '../../application/services/affiliate-registration.service';
import { AffiliateCommissionService } from '../../application/services/affiliate-commission.service';
import { AffiliateKycService } from '../../application/services/affiliate-kyc.service';
import { AffiliatePayoutService } from '../../application/services/affiliate-payout.service';
import { AffiliatePhoneVerificationService } from '../../application/services/affiliate-phone-verification.service';
import { SubmitAffiliateKycDto } from '../dtos/affiliate-kyc.dto';
import { AddPayoutMethodDto } from '../dtos/affiliate-payout.dto';
import { AffiliateUpdateProfileDto } from '../dtos/affiliate-update-profile.dto';
import {
  AffiliateSendPhoneOtpDto,
  AffiliateVerifyPhoneOtpDto,
} from '../dtos/affiliate-phone-verification.dto';

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
    private readonly phoneVerificationService: AffiliatePhoneVerificationService,
  ) {}

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

  // ── Phone verification ──────────────────────────────────────

  @Post('phone/send-otp')
  @HttpCode(HttpStatus.OK)
  async sendPhoneOtp(@Req() req: Request, @Body() dto: AffiliateSendPhoneOtpDto) {
    const affiliateId = (req as any).affiliateId;
    const data = await this.phoneVerificationService.sendOtp(affiliateId, dto.phone);
    return {
      success: true,
      message: 'OTP sent. Check WhatsApp (or your inbox if WhatsApp is unavailable).',
      data,
    };
  }

  @Post('phone/verify-otp')
  @HttpCode(HttpStatus.OK)
  async verifyPhoneOtp(@Req() req: Request, @Body() dto: AffiliateVerifyPhoneOtpDto) {
    const affiliateId = (req as any).affiliateId;
    await this.phoneVerificationService.verifyOtp(affiliateId, dto.otp);
    return {
      success: true,
      message: 'Phone verified.',
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

  /**
   * Upload a KYC document image. Affiliate picks a JPG/PNG/WEBP scan
   * of their PAN or Aadhaar card; we push it to Cloudinary in a
   * folder scoped to this affiliate, and return the secure URL the
   * caller then submits as `panDocumentUrl` / `aadhaarDocumentUrl`
   * via POST /affiliate/me/kyc.
   *
   * Image-only by design — Cloudinary's upload pipeline rejects
   * non-image MIME types up front (see CloudinaryAdapter), and we
   * reinforce with magic-byte validation to defeat misnamed files.
   */
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
  async requestPayout(@Req() req: Request) {
    const affiliateId = (req as any).affiliateId;
    const data = await this.payoutService.requestPayout({ affiliateId });
    return {
      success: true,
      message: 'Payout requested. Admin will review and process the transfer.',
      data,
    };
  }
}
