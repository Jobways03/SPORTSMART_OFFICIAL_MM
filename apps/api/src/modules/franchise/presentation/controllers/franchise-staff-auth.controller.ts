import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { FranchiseStaffAuthGuard } from '../../../../core/guards';
import { FranchiseStaffAuthService } from '../../application/auth/franchise-staff-auth.service';
import { FranchiseStaffLoginDto } from '../dtos/franchise-staff-login.dto';
import { FranchiseStaffActivateDto } from '../dtos/franchise-staff-activate.dto';

/**
 * Phase 159u (staff-auth B1/B4) — staff login/activation/refresh/logout. Tokens
 * are returned in the body (Bearer flow for POS terminals); the guards also
 * accept them. Separate controller (no FranchiseAuthGuard) so login/activate
 * are reachable without an owner session.
 */
@ApiTags('Franchise Staff Auth')
@Controller('franchise/staff/auth')
export class FranchiseStaffAuthController {
  constructor(private readonly authService: FranchiseStaffAuthService) {}

  @Post('activate')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async activate(@Body() dto: FranchiseStaffActivateDto) {
    const data = await this.authService.activate(dto.token, dto.password);
    return { success: true, message: 'Account activated. You can now sign in.', data };
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async login(@Body() dto: FranchiseStaffLoginDto, @Req() req: Request) {
    const data = await this.authService.login({
      franchiseCode: dto.franchiseCode,
      email: dto.email,
      password: dto.password,
      userAgent: req.headers['user-agent'] ?? null,
      ipAddress: req.ip ?? null,
    });
    return { success: true, message: 'Login successful', data };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async refresh(@Body() body: { refreshToken?: string }) {
    const data = await this.authService.refresh(body?.refreshToken ?? '');
    return { success: true, message: 'Session refreshed', data };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(FranchiseStaffAuthGuard)
  async logout(@Req() req: Request) {
    await this.authService.logout((req as any).staffId);
    return { success: true, message: 'Logged out.' };
  }
}
