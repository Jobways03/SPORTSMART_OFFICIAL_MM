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
import { FranchiseAuthGuard, FranchiseActiveGuard } from '../../../../core/guards';
import { FranchiseStaffService } from '../../application/services/franchise-staff.service';
import { FranchiseAddStaffDto } from '../dtos/franchise-add-staff.dto';
import { FranchiseUpdateStaffDto } from '../dtos/franchise-update-staff.dto';

@ApiTags('Franchise Staff')
@Controller('franchise/staff')
// Phase 159t (audit #6) — staff management is a business action; require an
// ACTIVE (⟹ VERIFIED) franchise, matching the catalog/inventory/POS surfaces.
// NOTE (audit #7): per-staff RBAC for the staff-auth subsystem uses the
// StaffPermissions decorator on the business controllers; the OWNER inherently
// manages their own staff via this owner-scoped controller.
@UseGuards(FranchiseAuthGuard, FranchiseActiveGuard)
export class FranchiseStaffController {
  constructor(
    private readonly franchiseStaffService: FranchiseStaffService,
  ) {}

  @Get()
  async listStaff(@Req() req: Request) {
    const franchiseId = (req as any).franchiseId;
    const data = await this.franchiseStaffService.listStaff(franchiseId);

    return {
      success: true,
      message: 'Staff list fetched successfully',
      data,
    };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  // Phase 159t (audit #17) — cap mass staff creation from a compromised owner session.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async addStaff(
    @Req() req: Request,
    @Body() dto: FranchiseAddStaffDto,
  ) {
    const franchiseId = (req as any).franchiseId;
    // Owner-level actor for createdBy/audit; becomes the staff id once the
    // staff-auth subsystem (surfaced) populates req.staffId.
    const actorId = (req as any).staffId ?? franchiseId;
    const data = await this.franchiseStaffService.addStaff(franchiseId, dto, actorId);

    return {
      success: true,
      message: 'Staff member added successfully',
      data,
    };
  }

  @Get(':staffId')
  async getStaff(
    @Req() req: Request,
    @Param('staffId') staffId: string,
  ) {
    const franchiseId = (req as any).franchiseId;
    const data = await this.franchiseStaffService.getStaff(franchiseId, staffId);

    return {
      success: true,
      message: 'Staff member fetched successfully',
      data,
    };
  }

  @Patch(':staffId')
  @HttpCode(HttpStatus.OK)
  async updateStaff(
    @Req() req: Request,
    @Param('staffId') staffId: string,
    @Body() dto: FranchiseUpdateStaffDto,
  ) {
    const franchiseId = (req as any).franchiseId;
    const actorId = (req as any).staffId ?? franchiseId;
    const data = await this.franchiseStaffService.updateStaff(franchiseId, staffId, dto, actorId);

    return {
      success: true,
      message: 'Staff member updated successfully',
      data,
    };
  }

  @Delete(':staffId')
  @HttpCode(HttpStatus.OK)
  async removeStaff(
    @Req() req: Request,
    @Param('staffId') staffId: string,
    @Query('reason') reason?: string,
  ) {
    const franchiseId = (req as any).franchiseId;
    const actorId = (req as any).staffId ?? franchiseId;
    await this.franchiseStaffService.removeStaff(franchiseId, staffId, actorId, reason);

    return {
      success: true,
      message: 'Staff member removed successfully',
    };
  }
}
