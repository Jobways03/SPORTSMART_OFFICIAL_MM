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
import { Request } from 'express';
import { AdminAuthGuard, RolesGuard } from '../../../../core/guards';
import { Roles } from '../../../../core/decorators/roles.decorator';
import { AdminListFranchisesUseCase } from '../../application/use-cases/admin-list-franchises.use-case';
import { AdminGetFranchiseUseCase } from '../../application/use-cases/admin-get-franchise.use-case';
import { AdminUpdateFranchiseStatusUseCase } from '../../application/use-cases/admin-update-franchise-status.use-case';
import { AdminUpdateFranchiseVerificationUseCase } from '../../application/use-cases/admin-update-franchise-verification.use-case';
import { AdminUpdateFranchiseCommissionUseCase } from '../../application/use-cases/admin-update-franchise-commission.use-case';
import { AdminEditFranchiseProfileUseCase } from '../../application/use-cases/admin-edit-franchise-profile.use-case';
import { AdminSendFranchiseMessageUseCase } from '../../application/use-cases/admin-send-franchise-message.use-case';
import { AdminChangeFranchisePasswordUseCase } from '../../application/use-cases/admin-change-franchise-password.use-case';
import { AdminImpersonateFranchiseUseCase } from '../../application/use-cases/admin-impersonate-franchise.use-case';
import { AdminDeleteFranchiseUseCase } from '../../application/use-cases/admin-delete-franchise.use-case';
import { AdminUpdateFranchiseStatusDto } from '../dtos/admin-update-franchise-status.dto';
import { AdminUpdateFranchiseVerificationDto } from '../dtos/admin-update-franchise-verification.dto';
import { AdminUpdateFranchiseCommissionDto } from '../dtos/admin-update-franchise-commission.dto';
import { AdminEditFranchiseProfileDto } from '../dtos/admin-edit-franchise-profile.dto';
import { AdminSendFranchiseMessageDto } from '../dtos/admin-send-franchise-message.dto';
import { AdminChangeFranchisePasswordDto } from '../dtos/admin-change-franchise-password.dto';

@ApiTags('Admin Franchise')
@Controller('admin/franchises')
@UseGuards(AdminAuthGuard, RolesGuard)
export class AdminFranchiseController {
  constructor(
    private readonly adminListFranchisesUseCase: AdminListFranchisesUseCase,
    private readonly adminGetFranchiseUseCase: AdminGetFranchiseUseCase,
    private readonly adminUpdateFranchiseStatusUseCase: AdminUpdateFranchiseStatusUseCase,
    private readonly adminUpdateFranchiseVerificationUseCase: AdminUpdateFranchiseVerificationUseCase,
    private readonly adminUpdateFranchiseCommissionUseCase: AdminUpdateFranchiseCommissionUseCase,
    private readonly adminEditFranchiseProfileUseCase: AdminEditFranchiseProfileUseCase,
    private readonly adminSendFranchiseMessageUseCase: AdminSendFranchiseMessageUseCase,
    private readonly adminChangeFranchisePasswordUseCase: AdminChangeFranchisePasswordUseCase,
    private readonly adminImpersonateFranchiseUseCase: AdminImpersonateFranchiseUseCase,
    private readonly adminDeleteFranchiseUseCase: AdminDeleteFranchiseUseCase,
  ) {}

  @Get()
  async listFranchises(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('verificationStatus') verificationStatus?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: string,
  ) {
    const data = await this.adminListFranchisesUseCase.execute({
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      search,
      status,
      verificationStatus,
      sortBy,
      sortOrder,
    });

    return { success: true, message: 'Franchises fetched successfully', data };
  }

  @Get(':franchiseId')
  async getFranchise(@Param('franchiseId') franchiseId: string) {
    const data = await this.adminGetFranchiseUseCase.execute(franchiseId);
    return { success: true, message: 'Franchise details fetched successfully', data };
  }

  // ── Profile Edit ──────────────────────────────────────────

  @Patch(':franchiseId')
  @HttpCode(HttpStatus.OK)
  async editProfile(
    @Req() req: Request,
    @Param('franchiseId') franchiseId: string,
    @Body() dto: AdminEditFranchiseProfileDto,
  ) {
    const adminId = (req as any).adminId;
    const data = await this.adminEditFranchiseProfileUseCase.execute({
      adminId,
      franchiseId,
      ...dto,
    });

    return { success: true, message: 'Franchise profile updated by admin', data };
  }

  // ── Status / Verification / Commission ────────────────────

  @Patch(':franchiseId/status')
  @HttpCode(HttpStatus.OK)
  async updateStatus(
    @Req() req: Request,
    @Param('franchiseId') franchiseId: string,
    @Body() dto: AdminUpdateFranchiseStatusDto,
  ) {
    const adminId = (req as any).adminId;
    const data = await this.adminUpdateFranchiseStatusUseCase.execute({
      adminId,
      franchiseId,
      status: dto.status,
      reason: dto.reason,
    });

    return { success: true, message: 'Franchise status updated successfully', data };
  }

  @Patch(':franchiseId/verification')
  @HttpCode(HttpStatus.OK)
  async updateVerification(
    @Req() req: Request,
    @Param('franchiseId') franchiseId: string,
    @Body() dto: AdminUpdateFranchiseVerificationDto,
  ) {
    const adminId = (req as any).adminId;
    const data = await this.adminUpdateFranchiseVerificationUseCase.execute({
      adminId,
      franchiseId,
      verificationStatus: dto.verificationStatus,
      reason: dto.reason,
    });

    return { success: true, message: 'Franchise verification status updated successfully', data };
  }

  @Patch(':franchiseId/commission')
  @HttpCode(HttpStatus.OK)
  async updateCommission(
    @Req() req: Request,
    @Param('franchiseId') franchiseId: string,
    @Body() dto: AdminUpdateFranchiseCommissionDto,
  ) {
    const adminId = (req as any).adminId;
    const data = await this.adminUpdateFranchiseCommissionUseCase.execute({
      adminId,
      franchiseId,
      onlineFulfillmentRate: dto.onlineFulfillmentRate,
      procurementFeeRate: dto.procurementFeeRate,
    });

    return { success: true, message: 'Franchise commission rates updated successfully', data };
  }

  // ── Impersonate ───────────────────────────────────────────

  @Post(':franchiseId/impersonate')
  @HttpCode(HttpStatus.OK)
  @Roles('SUPER_ADMIN', 'SELLER_ADMIN')
  async impersonate(
    @Param('franchiseId') franchiseId: string,
    @Req() req: Request,
  ) {
    const adminId = (req as any).adminId;
    const data = await this.adminImpersonateFranchiseUseCase.execute({
      adminId,
      franchiseId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return { success: true, message: 'Impersonation token generated', data };
  }

  // ── Send Message ──────────────────────────────────────────

  @Post(':franchiseId/message')
  @HttpCode(HttpStatus.OK)
  async sendMessage(
    @Param('franchiseId') franchiseId: string,
    @Body() dto: AdminSendFranchiseMessageDto,
    @Req() req: Request,
  ) {
    const adminId = (req as any).adminId;
    const data = await this.adminSendFranchiseMessageUseCase.execute({
      adminId,
      franchiseId,
      subject: dto.subject,
      message: dto.message,
      channel: dto.channel,
    });

    return { success: true, message: 'Message sent to franchise', data };
  }

  // ── Change Password ───────────────────────────────────────

  @Patch(':franchiseId/change-password')
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @Param('franchiseId') franchiseId: string,
    @Body() dto: AdminChangeFranchisePasswordDto,
    @Req() req: Request,
  ) {
    const adminId = (req as any).adminId;
    const data = await this.adminChangeFranchisePasswordUseCase.execute({
      adminId,
      franchiseId,
      newPassword: dto.newPassword,
    });

    return { success: true, message: 'Franchise password changed', data };
  }

  // ── Delete ────────────────────────────────────────────────

  @Delete(':franchiseId')
  @HttpCode(HttpStatus.OK)
  @Roles('SUPER_ADMIN', 'SELLER_ADMIN')
  async deleteFranchise(
    @Param('franchiseId') franchiseId: string,
    @Body() body: { reason?: string },
    @Req() req: Request,
  ) {
    const adminId = (req as any).adminId;
    const data = await this.adminDeleteFranchiseUseCase.execute({
      adminId,
      franchiseId,
      reason: body?.reason,
    });

    return { success: true, message: 'Franchise deleted successfully', data };
  }
}
