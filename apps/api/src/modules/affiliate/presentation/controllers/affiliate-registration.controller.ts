import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { AffiliateRegistrationService } from '../../application/services/affiliate-registration.service';
import { RegisterAffiliateDto } from '../dtos/register-affiliate.dto';
import { CaptchaVerifierService } from '../../../../integrations/captcha/captcha-verifier.service';

/**
 * Public affiliate registration. No auth — anyone can apply. The
 * application lands as PENDING_APPROVAL; admin review (separate
 * endpoint) flips to ACTIVE.
 *
 * Phase 22 (2026-05-20) — Audit-driven hardening:
 *   • @Throttle 7/60s parity with customer + seller + franchise
 *     registers. Pre-Phase-22 the endpoint fell back to the global
 *     300/60s default, leaving it open to scripted flooding.
 *   • Captcha gate. hCaptcha / Turnstile token verified before the
 *     use-case runs so scripted bots burn cheap captcha checks
 *     instead of expensive bcrypt cost-12 hashes.
 *   • Forwards req.ip + user-agent to the service so the eventual
 *     affiliate.registered audit row has provenance.
 */
@ApiTags('Affiliate')
@Controller('affiliate')
export class AffiliateRegistrationController {
  constructor(
    private readonly registrationService: AffiliateRegistrationService,
    private readonly captcha: CaptchaVerifierService,
  ) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  // 7 registrations / 60s / IP — humane for an honest user fumbling the form,
  // still defeats scripted flooding.
  @Throttle({ default: { limit: 7, ttl: 60_000 } })
  async register(@Body() dto: RegisterAffiliateDto, @Req() req: Request) {
    await this.captcha.verify(dto.captchaToken, req.ip);
    const userAgent = req.headers['user-agent'];
    const data = await this.registrationService.register({
      email: dto.email,
      phone: dto.phone,
      firstName: dto.firstName,
      lastName: dto.lastName,
      password: dto.password,
      websiteUrl: dto.websiteUrl,
      socialHandle: dto.socialHandle,
      joinReason: dto.joinReason,
      acceptTerms: dto.acceptTerms,
      acceptPrivacy: dto.acceptPrivacy,
      acceptMarketing: dto.acceptMarketing,
      ipAddress: req.ip,
      userAgent: typeof userAgent === 'string' ? userAgent : undefined,
    });
    return {
      success: true,
      message: data.message,
      data,
    };
  }
}
