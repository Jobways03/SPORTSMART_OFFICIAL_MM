import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { UserAuthGuard } from '../../../../core/guards';
import { GetCustomerProfileUseCase } from '../../application/use-cases/get-customer-profile.use-case';
import { UpdateCustomerProfileUseCase } from '../../application/use-cases/update-customer-profile.use-case';
import { ChangeCustomerPasswordUseCase } from '../../application/use-cases/change-customer-password.use-case';

@ApiTags('Customer Profile')
@Controller('customer/me')
@UseGuards(UserAuthGuard)
export class CustomerProfileController {
  constructor(
    private readonly getProfileUseCase: GetCustomerProfileUseCase,
    private readonly updateProfileUseCase: UpdateCustomerProfileUseCase,
    private readonly changePasswordUseCase: ChangeCustomerPasswordUseCase,
  ) {}

  @Get()
  async getProfile(@Req() req: any) {
    const profile = await this.getProfileUseCase.execute(req.userId);
    return {
      success: true,
      message: 'Profile retrieved',
      data: profile,
    };
  }

  @Patch()
  async updateProfile(
    @Req() req: any,
    @Body()
    body: {
      firstName?: string;
      lastName?: string;
      email?: string;
      phone?: string | null;
    },
  ) {
    const profile = await this.updateProfileUseCase.execute(req.userId, body);
    return {
      success: true,
      message: 'Profile updated',
      data: profile,
    };
  }

  @Post('change-password')
  async changePassword(
    @Req() req: any,
    @Body()
    body: {
      currentPassword: string;
      newPassword: string;
      confirmPassword: string;
    },
  ) {
    await this.changePasswordUseCase.execute({
      userId: req.userId,
      currentPassword: body.currentPassword,
      newPassword: body.newPassword,
      confirmPassword: body.confirmPassword,
    });
    return {
      success: true,
      message: 'Password changed — please log in again with your new password',
      data: null,
    };
  }
}
