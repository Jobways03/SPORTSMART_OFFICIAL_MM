import {
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { SellerAuthGuard } from '../../../../core/guards';
import { LogoutSellerUseCase } from '../../application/use-cases/logout-seller.use-case';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { clearAuthCookies } from '../../../../core/auth/auth-cookie.helper';

@ApiTags('Seller Auth')
@Controller('seller/auth')
@UseGuards(SellerAuthGuard)
export class SellerLogoutController {
  constructor(
    private readonly logoutUseCase: LogoutSellerUseCase,
    private readonly env: EnvService,
  ) {}

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Query('all') all?: string,
  ) {
    const sellerId = (req as unknown as { sellerId?: string }).sellerId;
    const sessionId = (req as unknown as { sessionId?: string }).sessionId;
    if (!sellerId) {
      throw new UnauthorizedException('Seller session not found');
    }
    const revokeAll = all === 'true' || all === '1';

    let result: { revokedAll: boolean } = { revokedAll: revokeAll };
    try {
      result = await this.logoutUseCase.execute({
        sellerId,
        sessionId,
        all: revokeAll,
      });
    } finally {
      // Phase 21 (2026-05-20) — always clear the seller auth cookies,
      // even if the DB revoke threw. Stale cookies in the browser are
      // worse than a noisy log line.
      clearAuthCookies(
        res,
        'seller',
        this.env.getString('AUTH_COOKIE_DOMAIN', '') || null,
      );
    }

    return {
      success: true,
      message: result.revokedAll
        ? 'Logged out of all devices. Every active session has been revoked.'
        : 'Logged out successfully.',
      data: { revokedAll: result.revokedAll },
    };
  }
}
