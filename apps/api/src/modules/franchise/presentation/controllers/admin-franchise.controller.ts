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
import { AdminAuthGuard, RolesGuard, PermissionsGuard } from '../../../../core/guards';
import { Roles } from '../../../../core/decorators/roles.decorator';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
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
@UseGuards(AdminAuthGuard, RolesGuard, PermissionsGuard)
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
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Per-franchise tax oversight — surfaces GSTIN + state code (collected
   * on the franchise profile) alongside aggregated tax document totals
   * and the 10 most recent documents. Powers the "Tax" section on the
   * franchise detail page in web-franchise-admin.
   *
   * Like the franchise-self list endpoint, the filter hops via
   * `subOrder.franchiseId` because franchise tax docs are written with
   * `sellerId=null` today.
   */
  @Get(':franchiseId/tax-summary')
  async taxSummary(@Param('franchiseId') franchiseId: string) {
    const franchise = await this.prisma.franchisePartner.findUnique({
      where: { id: franchiseId },
      select: {
        id: true,
        gstNumber: true,
        panNumber: true,
        state: true,
        businessName: true,
        franchiseCode: true,
      },
    });
    if (!franchise) {
      return {
        success: false,
        message: 'Franchise not found',
        data: null,
      };
    }

    const subOrders = await this.prisma.subOrder.findMany({
      where: { franchiseId },
      select: { id: true },
    });
    const subOrderIds = subOrders.map((s) => s.id);

    const where: any = {
      OR: [
        { sellerId: franchiseId },
        { subOrderId: { in: subOrderIds } },
      ],
      status: { notIn: ['VOIDED_DRAFT', 'SUPERSEDED'] },
    };

    const [agg, recent, count] = await Promise.all([
      this.prisma.taxDocument.aggregate({
        where,
        _sum: {
          taxableAmountInPaise: true,
          cgstAmountInPaise: true,
          sgstAmountInPaise: true,
          igstAmountInPaise: true,
          totalTaxAmountInPaise: true,
          documentTotalInPaise: true,
        },
      }),
      this.prisma.taxDocument.findMany({
        where,
        select: {
          id: true,
          documentNumber: true,
          documentType: true,
          financialYear: true,
          generatedAt: true,
          status: true,
          documentTotalInPaise: true,
          totalTaxAmountInPaise: true,
          buyerLegalName: true,
        },
        orderBy: { generatedAt: 'desc' },
        take: 10,
      }),
      this.prisma.taxDocument.count({ where }),
    ]);

    return {
      success: true,
      message: 'Franchise tax summary fetched',
      data: {
        franchise: {
          id: franchise.id,
          franchiseCode: franchise.franchiseCode,
          businessName: franchise.businessName,
          gstNumber: franchise.gstNumber,
          panNumber: franchise.panNumber,
          state: franchise.state,
        },
        totals: {
          documentCount: count,
          taxableAmountInPaise: agg._sum.taxableAmountInPaise?.toString() ?? '0',
          cgstAmountInPaise: agg._sum.cgstAmountInPaise?.toString() ?? '0',
          sgstAmountInPaise: agg._sum.sgstAmountInPaise?.toString() ?? '0',
          igstAmountInPaise: agg._sum.igstAmountInPaise?.toString() ?? '0',
          totalTaxAmountInPaise: agg._sum.totalTaxAmountInPaise?.toString() ?? '0',
          documentTotalInPaise: agg._sum.documentTotalInPaise?.toString() ?? '0',
        },
        recentDocuments: recent.map((d) => ({
          id: d.id,
          documentNumber: d.documentNumber,
          documentType: d.documentType,
          financialYear: d.financialYear,
          generatedAt: d.generatedAt,
          status: d.status,
          documentTotalInPaise: d.documentTotalInPaise?.toString() ?? '0',
          totalTaxAmountInPaise: d.totalTaxAmountInPaise?.toString() ?? '0',
          buyerLegalName: d.buyerLegalName,
        })),
      },
    };
  }

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
