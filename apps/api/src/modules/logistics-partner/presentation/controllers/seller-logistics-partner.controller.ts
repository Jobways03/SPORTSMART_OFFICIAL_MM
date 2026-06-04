import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  ServiceUnavailableException,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SellerAuthGuard } from '../../../../core/guards';
import { CurrentSeller } from '../../../../core/decorators/current-actor.decorator';
import { LogisticsFacadePartnersService } from '../../../../integrations/logistics-facade/services/logistics-facade-partners.service';
import { ListSellerRegistrationsService } from '../../application/services/list-seller-registrations.service';
import { RegisterSellerWithPartnerService } from '../../application/services/register-seller-with-partner.service';
import {
  RegisterPartnerRequestSchema,
  type RegisterPartnerRequest,
  type RegisterPartnerResponse,
} from '../../application/dto/register-partner-request.dto';
import type {
  ListPartnersResponse,
  ListSellerRegistrationsResponse,
} from '../../application/dto/list-partners-response.dto';
import { ZodValidationPipe } from './zod-validation.pipe';

/**
 * Seller-facing endpoints that power the "Logistics partners" panel on
 * each seller-persona admin dashboard (retail / d2c / franchise).
 *
 * Mirrors {@link AdminLogisticsPartnerController} but the sellerId is
 * derived from the authenticated SellerAuthGuard context — never from
 * the path or body — so a logged-in seller can only see and modify
 * their own SellerPartnerRegistration rows.
 *
 * Auth: SellerAuthGuard (JWT). The guard attaches `request.sellerId`
 * which @CurrentSeller() reads. Impersonation tokens minted by an
 * admin still pass through (with `request.isImpersonation = true`)
 * — that path is intentional, so an admin can drive registration on
 * behalf of a seller without leaving the seller dashboard.
 */
@ApiTags('Seller — Logistics Partner')
@Controller('seller/logistics-partner')
@UseGuards(SellerAuthGuard)
export class SellerLogisticsPartnerController {
  constructor(
    private readonly facadePartners: LogisticsFacadePartnersService,
    private readonly listRegistrations: ListSellerRegistrationsService,
    private readonly registerService: RegisterSellerWithPartnerService,
  ) {}

  /**
   * Discover every partner the facade can talk to + capability matrix.
   * The seller UI uses this to decide which "Add pickup location"
   * buttons to render. Pass-through of the facade's `GET /v1/partners`
   * — same payload as the admin endpoint.
   */
  @Get('partners')
  @HttpCode(HttpStatus.OK)
  async listPartners(): Promise<ListPartnersResponse> {
    const result = await this.facadePartners.listPartners();
    if (!result.ok) {
      throw new ServiceUnavailableException(
        `Logistics facade unreachable: ${result.message}`,
      );
    }
    return result.data.map((p) => ({
      code: p.code,
      displayName: p.displayName,
      capabilities: { warehouseRegistration: p.capabilities.warehouseRegistration },
    }));
  }

  /**
   * Read every SellerPartnerRegistration row for the authenticated
   * seller. Combined with the partner list above to compute "which
   * buttons are pending / registered / failed" on the seller UI.
   *
   * Note the `my-registrations` path — there's no :sellerId param.
   * The sellerId is pinned to the JWT subject so a malicious caller
   * cannot enumerate another seller's registrations by guessing ids.
   */
  @Get('my-registrations')
  @HttpCode(HttpStatus.OK)
  async listMyRegistrations(
    @CurrentSeller() sellerId: string,
  ): Promise<ListSellerRegistrationsResponse> {
    return this.listRegistrations.execute(sellerId);
  }

  /**
   * Trigger registration of the authenticated seller's pickup address
   * with a partner. The sellerId comes from the JWT, NEVER from the
   * URL or body — there's no way for a seller to register a different
   * seller's pickup location.
   *
   * Same semantics as the admin endpoint: returns 200 with
   * `ok: false + error` on partner-side failure (NOT 5xx). The seller
   * UI renders the error inline so the seller can fix their profile
   * and retry without losing context. Hard pre-condition failures
   * (seller not ACTIVE) still throw — those are caller errors.
   */
  @Post('partners/:code/register')
  @HttpCode(HttpStatus.OK)
  @UsePipes()
  async registerMyPartner(
    @CurrentSeller() sellerId: string,
    @Param('code') partnerCode: string,
    @Body(new ZodValidationPipe(RegisterPartnerRequestSchema))
    _body: RegisterPartnerRequest,
  ): Promise<RegisterPartnerResponse> {
    return this.registerService.execute({
      sellerId,
      partnerCode,
      // The seller triggered their own registration — record their id
      // in registeredBy so the audit trail attributes the action to
      // the seller rather than the (non-existent) admin actor.
      triggeredBy: sellerId,
    });
  }
}
