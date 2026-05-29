import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { AdminAuthGuard, RolesGuard, PermissionsGuard } from '../../../../core/guards';
import { Permissions } from '../../../../core/decorators/permissions.decorator';
import { FranchisePincodeMappingService } from '../../application/services/franchise-pincode-mapping.service';
import {
  AssignPincodeDto,
  BulkAssignPincodesDto,
} from '../dtos/franchise-pincode-mapping.dto';

/**
 * Phase 159m — admin pincode → franchise coverage mapping.
 *
 * Routing (serviceability + allocation) consults these in "supplement" mode:
 * a pincode with ≥1 active mapping restricts eligibility to mapped franchises
 * (priority desc, then distance); unmapped pincodes fall back to distance.
 *
 * Admin-only; never exposed to franchise tokens (coverage is the platform's
 * routing config). Writes require `franchise.pincodes.write`.
 */
@ApiTags('Admin Franchise Pincodes')
@Controller('admin/franchises/:franchiseId/pincodes')
@UseGuards(AdminAuthGuard, RolesGuard, PermissionsGuard)
@Permissions('franchise.pincodes.read')
export class AdminFranchisePincodesController {
  constructor(private readonly service: FranchisePincodeMappingService) {}

  @Get()
  async list(@Param('franchiseId') franchiseId: string) {
    const data = await this.service.list(franchiseId);
    return { success: true, message: 'Pincode mappings retrieved', data };
  }

  @Put()
  @Permissions('franchise.pincodes.write')
  @HttpCode(HttpStatus.OK)
  async assign(
    @Req() req: Request,
    @Param('franchiseId') franchiseId: string,
    @Body() dto: AssignPincodeDto,
  ) {
    const data = await this.service.assign(franchiseId, dto, this.ctx(req));
    return { success: true, message: 'Pincode mapping saved', data };
  }

  @Post('bulk')
  @Permissions('franchise.pincodes.write')
  @HttpCode(HttpStatus.OK)
  // Bulk import is heavy (up to 5,000 rows / batch) — coarse abuse cap.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async bulkAssign(
    @Req() req: Request,
    @Param('franchiseId') franchiseId: string,
    @Body() dto: BulkAssignPincodesDto,
  ) {
    const data = await this.service.bulkAssign(franchiseId, dto, this.ctx(req));
    return { success: true, message: 'Pincode mappings imported', data };
  }

  @Delete(':mappingId')
  @Permissions('franchise.pincodes.write')
  @HttpCode(HttpStatus.OK)
  async remove(
    @Req() req: Request,
    @Param('franchiseId') franchiseId: string,
    @Param('mappingId') mappingId: string,
  ) {
    const data = await this.service.remove(franchiseId, mappingId, this.ctx(req));
    return { success: true, message: 'Pincode mapping removed', data };
  }

  private ctx(req: Request) {
    const ua = req.headers['user-agent'];
    return {
      adminId: (req as any).adminId as string | undefined,
      ipAddress: req.ip || req.socket?.remoteAddress || undefined,
      userAgent: typeof ua === 'string' ? ua : undefined,
    };
  }
}
