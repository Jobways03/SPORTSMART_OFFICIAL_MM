import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { FranchiseAuthGuard } from '../../../../core/guards';
import { GetFranchiseProfileUseCase } from '../../application/use-cases/get-franchise-profile.use-case';
import { UpdateFranchiseProfileUseCase } from '../../application/use-cases/update-franchise-profile.use-case';
import { FranchiseUpdateProfileDto } from '../dtos/franchise-update-profile.dto';

@Controller('franchise/profile')
@UseGuards(FranchiseAuthGuard)
export class FranchiseProfileController {
  constructor(
    private readonly getFranchiseProfileUseCase: GetFranchiseProfileUseCase,
    private readonly updateFranchiseProfileUseCase: UpdateFranchiseProfileUseCase,
  ) {}

  @Get()
  async getProfile(@Req() req: Request) {
    const franchiseId = (req as any).franchiseId;
    const data = await this.getFranchiseProfileUseCase.execute(franchiseId);

    return {
      success: true,
      message: 'Franchise profile fetched successfully',
      data,
    };
  }

  @Patch()
  @HttpCode(HttpStatus.OK)
  async updateProfile(
    @Req() req: Request,
    @Body() dto: FranchiseUpdateProfileDto,
  ) {
    const franchiseId = (req as any).franchiseId;
    const data = await this.updateFranchiseProfileUseCase.execute(franchiseId, dto);

    return {
      success: true,
      message: 'Franchise profile updated successfully',
      data,
    };
  }
}
