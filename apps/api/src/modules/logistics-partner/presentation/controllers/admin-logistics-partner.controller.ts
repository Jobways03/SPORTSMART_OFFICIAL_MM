import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
  ServiceUnavailableException,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import {
  AdminAuthGuard,
  PermissionsGuard,
} from '../../../../core/guards';
import { Permissions } from '../../../../core/decorators/permissions.decorator';
import { LogisticsFacadePartnersService } from '../../../../integrations/logistics-facade/services/logistics-facade-partners.service';
import { ListSellerRegistrationsService } from '../../application/services/list-seller-registrations.service';
import { RegisterSellerWithPartnerService } from '../../application/services/register-seller-with-partner.service';
import { RegisterFranchiseWithPartnerService } from '../../application/services/register-franchise-with-partner.service';
import {
  FRANCHISE_PARTNER_REGISTRATION_REPOSITORY,
  type FranchisePartnerRegistrationRepository,
} from '../../infrastructure/repositories/prisma-franchise-partner-registration.repository';
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
 * Admin-facing endpoints that power the "Partner registrations" panel
 * on the seller detail page.
 *
 * Auth: AdminAuthGuard (JWT) + PermissionsGuard. Permission key
 * `sellers.logistics.register` is checked on the write endpoint;
 * reads use `sellers.read`.
 */
@ApiTags('Admin — Logistics Partner')
@Controller('admin/logistics-partner')
@UseGuards(AdminAuthGuard, PermissionsGuard)
export class AdminLogisticsPartnerController {
  constructor(
    private readonly facadePartners: LogisticsFacadePartnersService,
    private readonly listRegistrations: ListSellerRegistrationsService,
    private readonly registerService: RegisterSellerWithPartnerService,
    private readonly registerFranchiseService: RegisterFranchiseWithPartnerService,
    @Inject(FRANCHISE_PARTNER_REGISTRATION_REPOSITORY)
    private readonly franchiseRegistrationRepo: FranchisePartnerRegistrationRepository,
  ) {}

  /**
   * Discover every partner the facade can talk to + capability
   * matrix. The admin UI uses this to decide which "Add pickup
   * location" buttons to render. Pass-through of the facade's
   * `GET /v1/partners`.
   */
  @Get('partners')
  @HttpCode(HttpStatus.OK)
  @Permissions('sellers.read')
  async listPartners(): Promise<{ success: true; data: ListPartnersResponse }> {
    const result = await this.facadePartners.listPartners();
    if (!result.ok) {
      throw new ServiceUnavailableException(
        `Logistics facade unreachable: ${result.message}`,
      );
    }
    // Wrap in the standard { success, data } envelope every other API
    // endpoint returns — the shared apiClient reads `.data`, so a bare
    // array leaves the panel's `partnersRes.data` undefined.
    const data = result.data.map((p) => ({
      code: p.code,
      displayName: p.displayName,
      capabilities: { warehouseRegistration: p.capabilities.warehouseRegistration },
    }));
    return { success: true, data };
  }

  /**
   * Read every SellerPartnerRegistration row for one seller. Combined
   * with the partner list above to compute "which buttons are pending /
   * registered / failed" on the admin UI.
   */
  @Get('sellers/:sellerId/registrations')
  @HttpCode(HttpStatus.OK)
  @Permissions('sellers.read')
  async listForSeller(
    @Param('sellerId') sellerId: string,
  ): Promise<{ success: true; data: ListSellerRegistrationsResponse }> {
    const data = await this.listRegistrations.execute(sellerId);
    return { success: true, data };
  }

  /**
   * Trigger registration of a seller's pickup address with a partner.
   *
   * IMPORTANT: returns 200 with `ok: false + error` on partner-side
   * failure (NOT 5xx). The admin UI renders the error inline so the
   * admin can edit the seller profile and retry without losing
   * context. Hard pre-condition failures (seller not found, seller not
   * ACTIVE) still throw — those are caller errors.
   */
  @Post('sellers/:sellerId/partners/:code/register')
  @HttpCode(HttpStatus.OK)
  @Permissions('sellers.logistics.register')
  @UsePipes()
  async register(
    @Param('sellerId') sellerId: string,
    @Param('code') partnerCode: string,
    @Body(new ZodValidationPipe(RegisterPartnerRequestSchema))
    _body: RegisterPartnerRequest,
    @Req() req: Request,
  ): Promise<{ success: true; data: RegisterPartnerResponse }> {
    const adminId = (req as unknown as { adminId?: string }).adminId;
    const data = await this.registerService.execute({
      sellerId,
      partnerCode,
      triggeredBy: adminId,
    });
    return { success: true, data };
  }

  /**
   * Push the seller's current address to an already-registered partner
   * warehouse. Used by the seller-admin "Update address to Delhivery"
   * button after the admin edits the (locked-for-seller) address.
   */
  @Post('sellers/:sellerId/partners/:code/update-address')
  @HttpCode(HttpStatus.OK)
  @Permissions('sellers.logistics.register')
  @UsePipes()
  async updateAddress(
    @Param('sellerId') sellerId: string,
    @Param('code') partnerCode: string,
    @Req() req: Request,
  ): Promise<{ success: true; data: RegisterPartnerResponse }> {
    const adminId = (req as unknown as { adminId?: string }).adminId;
    const data = await this.registerService.updateAddress({
      sellerId,
      partnerCode,
      triggeredBy: adminId,
    });
    return { success: true, data };
  }

  /* ── Franchise variants ─────────────────────────────────────────
   * Franchises register their store as a pickup warehouse the same way
   * sellers do, but via a franchise-scoped service + table. The partner
   * catalogue (GET /partners) is shared.
   */

  @Get('franchises/:franchiseId/registrations')
  @HttpCode(HttpStatus.OK)
  @Permissions('sellers.read')
  async listForFranchise(
    @Param('franchiseId') franchiseId: string,
  ): Promise<{ success: true; data: ListSellerRegistrationsResponse }> {
    const rows = await this.franchiseRegistrationRepo.findByFranchiseId(
      franchiseId,
    );
    const data = rows.map((r) => ({
      partner: r.partner,
      warehouseName: r.warehouseName,
      status: r.status,
      lastError: r.lastError,
      registeredAt: r.registeredAt ? r.registeredAt.toISOString() : null,
      registeredBy: r.registeredBy,
      updatedAt: r.updatedAt.toISOString(),
    })) as unknown as ListSellerRegistrationsResponse;
    return { success: true, data };
  }

  @Post('franchises/:franchiseId/partners/:code/register')
  @HttpCode(HttpStatus.OK)
  @Permissions('sellers.logistics.register')
  @UsePipes()
  async registerFranchise(
    @Param('franchiseId') franchiseId: string,
    @Param('code') partnerCode: string,
    @Body(new ZodValidationPipe(RegisterPartnerRequestSchema))
    _body: RegisterPartnerRequest,
    @Req() req: Request,
  ): Promise<{ success: true; data: RegisterPartnerResponse }> {
    const adminId = (req as unknown as { adminId?: string }).adminId;
    const data = await this.registerFranchiseService.execute({
      franchiseId,
      partnerCode,
      triggeredBy: adminId,
    });
    return { success: true, data };
  }

  @Post('franchises/:franchiseId/partners/:code/update-address')
  @HttpCode(HttpStatus.OK)
  @Permissions('sellers.logistics.register')
  @UsePipes()
  async updateFranchiseAddress(
    @Param('franchiseId') franchiseId: string,
    @Param('code') partnerCode: string,
    @Req() req: Request,
  ): Promise<{ success: true; data: RegisterPartnerResponse }> {
    const adminId = (req as unknown as { adminId?: string }).adminId;
    const data = await this.registerFranchiseService.updateAddress({
      franchiseId,
      partnerCode,
      triggeredBy: adminId,
    });
    return { success: true, data };
  }
}
