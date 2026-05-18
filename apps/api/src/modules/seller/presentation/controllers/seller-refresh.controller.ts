import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { RefreshSellerSessionUseCase } from '../../application/use-cases/refresh-seller-session.use-case';
import { AccessLogService } from '../../../access-log/application/services/access-log.service';

@ApiTags('Seller Auth')
@Controller('seller/auth')
export class SellerRefreshController {
  constructor(
    private readonly refreshSellerSessionUseCase: RefreshSellerSessionUseCase,
    private readonly accessLog: AccessLogService,
  ) {}

  // Public route — authentication is implicit in the refresh token itself.
  // Throttle is higher than login because legitimate clients may burst on
  // page load (several requests racing a freshly-expired access token);
  // single-flight refresh on the client side keeps this well under the cap.
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async refresh(
    @Body() body: { refreshToken: string },
    @Req() req: Request,
  ) {
    const ipAddress = req.ip;
    const userAgent = req.headers['user-agent'];

    const data = await this.refreshSellerSessionUseCase.execute({
      refreshToken: body?.refreshToken,
    });

    this.accessLog
      .record({
        actorType: 'SELLER',
        actorId: data.sellerId,
        kind: 'TOKEN_REFRESH',
        ipAddress,
        userAgent,
      })
      .catch(() => undefined);

    return {
      success: true,
      message: 'Session refreshed',
      data,
    };
  }
}
