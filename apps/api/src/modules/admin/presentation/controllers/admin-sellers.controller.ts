import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import {
  AdminAuthGuard,
  RolesGuard,
  PermissionsGuard,
  AdminSellerScopeGuard,
  RequiresStepUp,
  StepUpGuard,
} from '../../../../core/guards';
import { Roles } from '../../../../core/decorators/roles.decorator';
import { Permissions } from '../../../../core/decorators/permissions.decorator';
import { resolveSellerScope } from '../../../../core/authorization/seller-scope';
import { ForbiddenAppException } from '../../../../core/exceptions/forbidden.exception';
import { AdminListSellersUseCase } from '../../application/use-cases/admin-list-sellers.use-case';
import { AdminGetSellerUseCase } from '../../application/use-cases/admin-get-seller.use-case';
import { AdminEditSellerUseCase } from '../../application/use-cases/admin-edit-seller.use-case';
import { AdminUpdateSellerStatusUseCase } from '../../application/use-cases/admin-update-seller-status.use-case';
import { AdminUpdateSellerVerificationUseCase } from '../../application/use-cases/admin-update-seller-verification.use-case';
import { AdminVerifySellerTaxIdsUseCase } from '../../application/use-cases/admin-verify-seller-tax-ids.use-case';
import { AdminImpersonateSellerUseCase } from '../../application/use-cases/admin-impersonate-seller.use-case';
import { AdminEndImpersonationUseCase } from '../../application/use-cases/admin-end-impersonation.use-case';
import { AdminSendSellerMessageUseCase } from '../../application/use-cases/admin-send-seller-message.use-case';
import { AdminChangeSellerPasswordUseCase } from '../../application/use-cases/admin-change-seller-password.use-case';
import { AdminDeleteSellerUseCase } from '../../application/use-cases/admin-delete-seller.use-case';
import { AdminSellerFulfillmentHoldUseCase } from '../../application/use-cases/admin-seller-fulfillment-hold.use-case';
import { AdminListSellersDto } from '../dtos/admin-list-sellers.dto';
import { AdminSetSellerFulfillmentHoldDto } from '../dtos/admin-set-seller-fulfillment-hold.dto';
import { AdminUpdateSellerStatusDto } from '../dtos/admin-update-seller-status.dto';
import { AdminUpdateSellerVerificationDto } from '../dtos/admin-update-seller-verification.dto';
import { AdminSendMessageDto } from '../dtos/admin-send-message.dto';
import { AdminChangePasswordDto } from '../dtos/admin-change-password.dto';
import { AdminUpdateSellerProfileDto } from '../dtos/admin-update-seller-profile.dto';
import { AdminUpdateSellerBankUseCase } from '../../application/use-cases/admin-update-seller-bank.use-case';
import { UpdateSellerBankDetailsDto } from '../../../seller/presentation/dtos/update-seller-bank-details.dto';

@ApiTags('Admin Sellers')
@Controller('admin/sellers')
@UseGuards(AdminAuthGuard, RolesGuard, PermissionsGuard, AdminSellerScopeGuard, StepUpGuard)
export class AdminSellersController {
  constructor(
    private readonly listSellersUseCase: AdminListSellersUseCase,
    private readonly getSellerUseCase: AdminGetSellerUseCase,
    private readonly editSellerUseCase: AdminEditSellerUseCase,
    private readonly updateStatusUseCase: AdminUpdateSellerStatusUseCase,
    private readonly updateVerificationUseCase: AdminUpdateSellerVerificationUseCase,
    private readonly verifyTaxIdsUseCase: AdminVerifySellerTaxIdsUseCase,
    private readonly impersonateUseCase: AdminImpersonateSellerUseCase,
    // Phase 28 (2026-05-21) — shared use case; same dep injection
    // works for the franchise admin controller too.
    private readonly endImpersonationUseCase: AdminEndImpersonationUseCase,
    private readonly sendMessageUseCase: AdminSendSellerMessageUseCase,
    private readonly changePasswordUseCase: AdminChangeSellerPasswordUseCase,
    private readonly deleteSellerUseCase: AdminDeleteSellerUseCase,
    private readonly fulfillmentHoldUseCase: AdminSellerFulfillmentHoldUseCase,
    private readonly updateBankUseCase: AdminUpdateSellerBankUseCase,
  ) {}

  @Get()
  @Permissions('sellers.read')
  async listSellers(@Query() query: AdminListSellersDto, @Req() req: Request) {
    // Phase 38 (admin enforcement) — bound the list to the admin's
    // authoritative seller-type scope (from permissions, not the header). A
    // scoped admin that explicitly asks for a type outside its scope is
    // rejected rather than silently widened.
    const scope = resolveSellerScope((req as any).user?.permissions);
    if (
      !scope.unrestricted &&
      query.sellerType &&
      !scope.allowed.includes(query.sellerType)
    ) {
      throw new ForbiddenAppException(
        `Your account is scoped to ${scope.allowed.join(', ')} sellers; ` +
          `it cannot view ${query.sellerType} sellers.`,
        'SELLER_TYPE_OUT_OF_SCOPE',
      );
    }

    const data = await this.listSellersUseCase.execute({
      page: query.page || 1,
      limit: query.limit || 20,
      search: query.search,
      status: query.status,
      verificationStatus: query.verificationStatus,
      sellerType: query.sellerType,
      allowedSellerTypes: scope.unrestricted ? undefined : scope.allowed,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
      fromDate: query.fromDate,
      toDate: query.toDate,
    });

    return {
      success: true,
      message: 'Sellers fetched successfully',
      data,
    };
  }

  @Get(':sellerId')
  @Permissions('sellers.read')
  async getSeller(@Param('sellerId') sellerId: string) {
    const data = await this.getSellerUseCase.execute(sellerId);

    return {
      success: true,
      message: 'Seller details fetched',
      data,
    };
  }

  @Patch(':sellerId')
  @HttpCode(HttpStatus.OK)
  @Permissions('sellers.approve')
  async editSeller(
    @Param('sellerId') sellerId: string,
    @Body() dto: AdminUpdateSellerProfileDto,
    @Req() req: Request,
  ) {
    const adminId = (req as any).adminId;
    const data = await this.editSellerUseCase.execute({
      adminId,
      sellerId,
      payload: dto as unknown as Record<string, unknown>,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return {
      success: true,
      message: 'Seller profile updated by admin',
      data,
    };
  }

  @Patch(':sellerId/status')
  @HttpCode(HttpStatus.OK)
  @Permissions('sellers.suspend')
  async updateStatus(
    @Param('sellerId') sellerId: string,
    @Body() dto: AdminUpdateSellerStatusDto,
    @Req() req: Request,
  ) {
    const adminId = (req as any).adminId;
    const data = await this.updateStatusUseCase.execute({
      adminId,
      sellerId,
      status: dto.status,
      reason: dto.reason,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return {
      success: true,
      message: `Seller status updated to ${dto.status}`,
      data,
    };
  }

  /**
   * Phase 232 (eligible-node / allocation-preview audit) — place a risk/fraud
   * FULFILLMENT HOLD on a seller. A held seller is excluded from the allocation
   * engine (no auto-routing and no manual reassignment of new orders), so the
   * reason is mandatory and the action is gated on the same 'sellers.suspend'
   * management permission as the status change (both bench a seller). Stamps
   * actor + timestamp and writes a hash-chained audit row.
   */
  @Post(':sellerId/fulfillment-hold')
  @HttpCode(HttpStatus.OK)
  @Permissions('sellers.suspend')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async setFulfillmentHold(
    @Param('sellerId') sellerId: string,
    @Body() dto: AdminSetSellerFulfillmentHoldDto,
    @Req() req: Request,
  ) {
    const adminId = (req as any).adminId;
    const data = await this.fulfillmentHoldUseCase.setHold({
      adminId,
      sellerId,
      reason: dto.reason,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return {
      success: true,
      message: 'Seller fulfillment hold placed',
      data,
    };
  }

  /**
   * Phase 232 — clear the fulfillment hold (re-enable the seller for
   * allocation). Reason is optional here (the unblock is itself the record);
   * same permission + throttle as the SET path.
   */
  @Delete(':sellerId/fulfillment-hold')
  @HttpCode(HttpStatus.OK)
  @Permissions('sellers.suspend')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async clearFulfillmentHold(
    @Param('sellerId') sellerId: string,
    @Body() body: { reason?: string } = {},
    @Req() req: Request,
  ) {
    const adminId = (req as any).adminId;
    const data = await this.fulfillmentHoldUseCase.clearHold({
      adminId,
      sellerId,
      reason: body?.reason,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return {
      success: true,
      message: 'Seller fulfillment hold cleared',
      data,
    };
  }

  @Patch(':sellerId/verification')
  @HttpCode(HttpStatus.OK)
  @Permissions('sellers.approve')
  async updateVerification(
    @Param('sellerId') sellerId: string,
    @Body() dto: AdminUpdateSellerVerificationDto,
    @Req() req: Request,
  ) {
    const adminId = (req as any).adminId;
    const data = await this.updateVerificationUseCase.execute({
      adminId,
      sellerId,
      verificationStatus: dto.verificationStatus,
      reason: dto.reason,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return {
      success: true,
      message: `Seller verification updated to ${dto.verificationStatus}`,
      data,
    };
  }

  /**
   * Phase 254 — manually mark the seller's PAN as verified. This is the flag
   * the §194-O TDS engine keys off: an unverified PAN forces the §206AA
   * penalty rate (5%); verifying it drops TDS to the configured rate (1%).
   * Idempotent.
   */
  @Post(':sellerId/verify-pan')
  @HttpCode(HttpStatus.OK)
  @Permissions('sellers.approve')
  async verifyPan(
    @Param('sellerId') sellerId: string,
    @Body() body: { reason?: string } = {},
    @Req() req: Request,
  ) {
    const adminId = (req as any).adminId;
    const data = await this.verifyTaxIdsUseCase.verifyPan({
      adminId,
      sellerId,
      reason: body?.reason,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return {
      success: true,
      message: data.alreadyVerified
        ? 'Seller PAN was already verified'
        : 'Seller PAN verified',
      data,
    };
  }

  /**
   * Phase 254 — manually mark the seller's GSTIN as verified (admin checked
   * the portal; the automated GSTN provider is a stub today). Feeds tax
   * invoicing, not the TDS rate. Idempotent.
   */
  @Post(':sellerId/verify-gstin')
  @HttpCode(HttpStatus.OK)
  @Permissions('sellers.approve')
  async verifyGstin(
    @Param('sellerId') sellerId: string,
    @Body() body: { reason?: string } = {},
    @Req() req: Request,
  ) {
    const adminId = (req as any).adminId;
    const data = await this.verifyTaxIdsUseCase.verifyGst({
      adminId,
      sellerId,
      reason: body?.reason,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return {
      success: true,
      message: data.alreadyVerified
        ? 'Seller GSTIN was already verified'
        : 'Seller GSTIN verified',
      data,
    };
  }

  @Post(':sellerId/impersonate')
  @HttpCode(HttpStatus.OK)
  @Roles('SUPER_ADMIN', 'SELLER_ADMIN')
  @Permissions('sellers.approve')
  // Phase 26 — impersonation grants the admin a temporary seller token
  // with the seller's full surface, including bank/KYC pages. Treat
  // CRITICAL: tight 1-min window so a stolen admin session cannot
  // silently impersonate.
  @RequiresStepUp({ maxAgeMs: 60_000 })
  // Phase 28 (2026-05-21) — per-IP throttle. Step-up already gates
  // each call, but a compromised admin with a fresh step-up could
  // otherwise issue 300 tokens/min (global default). 10/min is
  // generous for ops while bounding the blast radius.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async impersonate(
    @Param('sellerId') sellerId: string,
    @Body() body: { reason?: string } = {},
    @Req() req: Request,
  ) {
    const adminId = (req as any).adminId;
    const adminRole = (req as any).adminRole;
    const data = await this.impersonateUseCase.execute({
      adminId,
      adminRole,
      sellerId,
      reason: body?.reason,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return {
      success: true,
      message: 'Impersonation token generated',
      data,
    };
  }

  /**
   * Phase 28 (2026-05-21) — End an active seller impersonation early.
   * Deletes the JTI from Redis (so the seller guard 401s the next
   * request even though the JWT still verifies by signature),
   * stamps endedAt on AdminImpersonationLog, writes an audit row,
   * and emits seller.impersonation_ended.
   *
   * Idempotent — already-ended impersonations return 200 without
   * re-stamping. Step-up not required (de-escalation, not escalation).
   */
  @Post('impersonations/:jti/end')
  @HttpCode(HttpStatus.OK)
  @Roles('SUPER_ADMIN', 'SELLER_ADMIN')
  @Permissions('sellers.approve')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async endImpersonation(
    @Param('jti') jti: string,
    @Body() body: { reason?: string } = {},
    @Req() req: Request,
  ) {
    const adminId = (req as any).adminId;
    const adminRole = (req as any).adminRole;
    const data = await this.endImpersonationUseCase.execute({
      tokenJti: jti,
      endedByActorId: adminId,
      endedByActorRole: adminRole,
      reason: body?.reason,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return { success: true, message: 'Impersonation ended', data };
  }

  @Post(':sellerId/message')
  @HttpCode(HttpStatus.OK)
  @Permissions('sellers.read')
  async sendMessage(
    @Param('sellerId') sellerId: string,
    @Body() dto: AdminSendMessageDto,
    @Req() req: Request,
  ) {
    const adminId = (req as any).adminId;
    const data = await this.sendMessageUseCase.execute({
      adminId,
      sellerId,
      subject: dto.subject,
      message: dto.message,
      channel: dto.channel,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return {
      success: true,
      message: 'Message sent to seller',
      data,
    };
  }

  @Patch(':sellerId/change-password')
  @HttpCode(HttpStatus.OK)
  @Permissions('sellers.approve')
  async changePassword(
    @Param('sellerId') sellerId: string,
    @Body() dto: AdminChangePasswordDto,
    @Req() req: Request,
  ) {
    const adminId = (req as any).adminId;
    const data = await this.changePasswordUseCase.execute({
      adminId,
      sellerId,
      newPassword: dto.newPassword,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return {
      success: true,
      message: 'Seller password changed',
      data,
    };
  }

  @Patch(':sellerId/bank-details')
  @HttpCode(HttpStatus.OK)
  @Permissions('sellers.approve')
  async updateBankDetails(
    @Param('sellerId') sellerId: string,
    @Body() dto: UpdateSellerBankDetailsDto,
    @Req() req: Request,
  ) {
    const adminId = (req as any).adminId;
    const data = await this.updateBankUseCase.execute({
      adminId,
      sellerId,
      accountHolderName: dto.accountHolderName,
      accountNumber: dto.accountNumber,
      ifscCode: dto.ifscCode,
      bankName: dto.bankName,
      upiVpa: dto.upiVpa,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return {
      success: true,
      message: 'Seller bank details updated',
      data,
    };
  }

  @Delete(':sellerId')
  @HttpCode(HttpStatus.OK)
  @Roles('SUPER_ADMIN', 'SELLER_ADMIN')
  @Permissions('sellers.suspend')
  async deleteSeller(
    @Param('sellerId') sellerId: string,
    @Body() body: { reason?: string },
    @Req() req: Request,
  ) {
    const adminId = (req as any).adminId;
    const adminRole = (req as any).adminRole;
    const data = await this.deleteSellerUseCase.execute({
      adminId,
      adminRole,
      sellerId,
      reason: body?.reason,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return {
      success: true,
      message: 'Seller deleted successfully',
      data,
    };
  }
}
