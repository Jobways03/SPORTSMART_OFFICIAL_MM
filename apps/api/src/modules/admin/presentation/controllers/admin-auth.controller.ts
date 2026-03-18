import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { AdminLoginDto } from '../dtos/admin-login.dto';
import { AdminLoginUseCase } from '../../application/use-cases/admin-login.use-case';
import { AdminLogoutUseCase } from '../../application/use-cases/admin-logout.use-case';
import { AdminGetMeUseCase } from '../../application/use-cases/admin-get-me.use-case';
import { AdminAuthGuard } from '../../infrastructure/guards/admin-auth.guard';

@Controller('admin/auth')
export class AdminAuthController {
  constructor(
    private readonly loginUseCase: AdminLoginUseCase,
    private readonly logoutUseCase: AdminLogoutUseCase,
    private readonly getMeUseCase: AdminGetMeUseCase,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: AdminLoginDto, @Req() req: Request) {
    const data = await this.loginUseCase.execute({
      email: dto.email,
      password: dto.password,
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    });

    return {
      success: true,
      message: 'Admin login successful',
      data,
    };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminAuthGuard)
  async logout(@Req() req: Request) {
    const adminId = (req as any).adminId;
    await this.logoutUseCase.execute(adminId);

    return {
      success: true,
      message: 'Logged out successfully',
    };
  }

  @Get('me')
  @UseGuards(AdminAuthGuard)
  async getMe(@Req() req: Request) {
    const adminId = (req as any).adminId;
    const data = await this.getMeUseCase.execute(adminId);

    return {
      success: true,
      message: 'Admin profile fetched',
      data,
    };
  }
}
