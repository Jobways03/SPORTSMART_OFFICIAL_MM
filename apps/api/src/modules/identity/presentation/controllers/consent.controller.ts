import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { UserAuthGuard } from '../../../../core/guards';
import { ConsentService } from '../../application/services/consent.service';
import { SetConsentDto } from '../dtos/set-consent.dto';

/**
 * Customer consent surface (DPDP §6).
 *
 * GET  /customer/consent          — current state across all purposes
 * POST /customer/consent          — flip a single purpose on/off
 *
 * Every write goes through ConsentService → AuditPublicFacade so the
 * change is captured in the tamper-evident hash chain. The same
 * endpoint is used for cookie banner consent (web-storefront) and
 * marketing-preferences toggles (account settings page).
 */
@ApiTags('Customer Consent')
@Controller('customer/consent')
@UseGuards(UserAuthGuard)
export class ConsentController {
  constructor(private readonly consentService: ConsentService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async getConsent(@Req() req: Request & { userId?: string }) {
    if (!req.userId) {
      // Defensive — guard already rejects.
      return { success: false, message: 'Customer session not found' };
    }
    const data = await this.consentService.getCurrent(req.userId);
    return {
      success: true,
      message: 'Current consent state',
      data,
    };
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  async setConsent(
    @Req() req: Request & { userId?: string },
    @Body() dto: SetConsentDto,
  ) {
    if (!req.userId) {
      return { success: false, message: 'Customer session not found' };
    }
    const data = await this.consentService.setConsent(
      req.userId,
      dto.purpose,
      dto.granted,
      {
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'] ?? undefined,
        source: 'customer-portal',
      },
    );
    return {
      success: true,
      message: data.changed
        ? `Consent for ${dto.purpose} updated`
        : `Consent for ${dto.purpose} already in this state — no change`,
      data,
    };
  }
}
