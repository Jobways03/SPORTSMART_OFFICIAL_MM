import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { UserAuthGuard } from '../../../../core/guards';
import { ConsentService } from '../../application/services/consent.service';
import { SetConsentDto } from '../dtos/set-consent.dto';

/**
 * Customer consent surface (DPDP §6).
 *
 *   GET  /customer/consent          — current state across all purposes
 *   POST /customer/consent          — flip a single revocable purpose
 *   GET  /customer/consent/history  — paginated audit-log timeline
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
      meta: { currentPolicyVersion: ConsentService.CURRENT_POLICY_VERSION },
    };
  }

  /**
   * Phase 28 (2026-05-21) — DPDP §11 right-of-access. Paginated view of
   * the customer's own consent change history sourced from the AuditLog
   * hash chain.
   */
  @Get('history')
  @HttpCode(HttpStatus.OK)
  async getHistory(
    @Req() req: Request & { userId?: string },
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    if (!req.userId) {
      return { success: false, message: 'Customer session not found' };
    }
    const parsedLimit = limit ? Number.parseInt(limit, 10) : undefined;
    const parsedOffset = offset ? Number.parseInt(offset, 10) : undefined;
    const data = await this.consentService.getHistory(req.userId, {
      limit: Number.isFinite(parsedLimit) ? parsedLimit : undefined,
      offset: Number.isFinite(parsedOffset) ? parsedOffset : undefined,
    });
    return {
      success: true,
      message: 'Consent change history',
      data,
    };
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  // Phase 28 (2026-05-21) — a valid customer JWT could otherwise spam
  // the audit log with toggle flips (idempotency would absorb same-state
  // re-asserts; alternating ON/OFF would still produce log noise).
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
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
        source: dto.source ?? 'customer-portal',
        consentVersion: dto.consentVersion,
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
