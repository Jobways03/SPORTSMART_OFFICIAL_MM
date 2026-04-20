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
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { FranchiseAuthGuard } from '../../../../core/guards';
import { FranchiseStaffService } from '../../application/services/franchise-staff.service';
import { FranchiseAddStaffDto } from '../dtos/franchise-add-staff.dto';
import { FranchiseUpdateStaffDto } from '../dtos/franchise-update-staff.dto';

@ApiTags('Franchise Staff')
@Controller('franchise/staff')
@UseGuards(FranchiseAuthGuard)
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
  async addStaff(
    @Req() req: Request,
    @Body() dto: FranchiseAddStaffDto,
  ) {
    const franchiseId = (req as any).franchiseId;
    const data = await this.franchiseStaffService.addStaff(franchiseId, dto);

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
    const data = await this.franchiseStaffService.updateStaff(franchiseId, staffId, dto);

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
  ) {
    const franchiseId = (req as any).franchiseId;
    await this.franchiseStaffService.removeStaff(franchiseId, staffId);

    return {
      success: true,
      message: 'Staff member removed successfully',
    };
  }
}
