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
import { Request } from 'express';
import { AdminAuthGuard } from '../../../../core/guards';
import { AdminListSellersUseCase } from '../../application/use-cases/admin-list-sellers.use-case';
import { AdminGetSellerUseCase } from '../../application/use-cases/admin-get-seller.use-case';
import { AdminEditSellerUseCase } from '../../application/use-cases/admin-edit-seller.use-case';
import { AdminUpdateSellerStatusUseCase } from '../../application/use-cases/admin-update-seller-status.use-case';
import { AdminUpdateSellerVerificationUseCase } from '../../application/use-cases/admin-update-seller-verification.use-case';
import { AdminImpersonateSellerUseCase } from '../../application/use-cases/admin-impersonate-seller.use-case';
import { AdminSendSellerMessageUseCase } from '../../application/use-cases/admin-send-seller-message.use-case';
import { AdminChangeSellerPasswordUseCase } from '../../application/use-cases/admin-change-seller-password.use-case';
import { AdminDeleteSellerUseCase } from '../../application/use-cases/admin-delete-seller.use-case';
import { AdminListSellersDto } from '../dtos/admin-list-sellers.dto';
import { AdminUpdateSellerStatusDto } from '../dtos/admin-update-seller-status.dto';
import { AdminUpdateSellerVerificationDto } from '../dtos/admin-update-seller-verification.dto';
import { AdminSendMessageDto } from '../dtos/admin-send-message.dto';
import { AdminChangePasswordDto } from '../dtos/admin-change-password.dto';
import { AdminUpdateSellerProfileDto } from '../dtos/admin-update-seller-profile.dto';

@Controller('admin/sellers')
@UseGuards(AdminAuthGuard)
export class AdminSellersController {
  constructor(
    private readonly listSellersUseCase: AdminListSellersUseCase,
    private readonly getSellerUseCase: AdminGetSellerUseCase,
    private readonly editSellerUseCase: AdminEditSellerUseCase,
    private readonly updateStatusUseCase: AdminUpdateSellerStatusUseCase,
    private readonly updateVerificationUseCase: AdminUpdateSellerVerificationUseCase,
    private readonly impersonateUseCase: AdminImpersonateSellerUseCase,
    private readonly sendMessageUseCase: AdminSendSellerMessageUseCase,
    private readonly changePasswordUseCase: AdminChangeSellerPasswordUseCase,
    private readonly deleteSellerUseCase: AdminDeleteSellerUseCase,
  ) {}

  @Get()
  async listSellers(@Query() query: AdminListSellersDto) {
    const data = await this.listSellersUseCase.execute({
      page: query.page || 1,
      limit: query.limit || 20,
      search: query.search,
      status: query.status,
      verificationStatus: query.verificationStatus,
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

  @Patch(':sellerId/verification')
  @HttpCode(HttpStatus.OK)
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

  @Post(':sellerId/impersonate')
  @HttpCode(HttpStatus.OK)
  async impersonate(
    @Param('sellerId') sellerId: string,
    @Req() req: Request,
  ) {
    const adminId = (req as any).adminId;
    const adminRole = (req as any).adminRole;
    const data = await this.impersonateUseCase.execute({
      adminId,
      adminRole,
      sellerId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return {
      success: true,
      message: 'Impersonation token generated',
      data,
    };
  }

  @Post(':sellerId/message')
  @HttpCode(HttpStatus.OK)
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

  @Delete(':sellerId')
  @HttpCode(HttpStatus.OK)
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
