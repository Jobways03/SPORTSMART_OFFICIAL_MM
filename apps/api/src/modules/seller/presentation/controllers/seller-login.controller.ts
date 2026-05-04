import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { SellerLoginDto } from '../dtos/seller-login.dto';
import { LoginSellerUseCase } from '../../application/use-cases/login-seller.use-case';
import { AccessLogService } from '../../../access-log/application/services/access-log.service';

@ApiTags('Seller Auth')
@Controller('seller/auth')
export class SellerLoginController {
  constructor(
    private readonly loginSellerUseCase: LoginSellerUseCase,
    private readonly accessLog: AccessLogService,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async login(@Body() dto: SellerLoginDto, @Req() req: Request) {
    const ipAddress = req.ip;
    const userAgent = req.headers['user-agent'];
    try {
      const data = await this.loginSellerUseCase.execute({
        identifier: dto.identifier,
        password: dto.password,
        userAgent,
        ipAddress,
      });

      const sellerId = (data as any)?.seller?.id ?? (data as any)?.sellerId;
      if (sellerId) {
        this.accessLog
          .record({
            actorType: 'SELLER',
            actorId: sellerId,
            kind: 'LOGIN_SUCCESS',
            ipAddress,
            userAgent,
          })
          .catch(() => undefined);
      }

      return {
        success: true,
        message: 'Login successful',
        data,
      };
    } catch (err) {
      this.accessLog
        .record({
          actorType: 'SELLER',
          actorId: dto.identifier,
          kind: 'LOGIN_FAILURE',
          ipAddress,
          userAgent,
          succeeded: false,
          reason: (err as Error).message,
        })
        .catch(() => undefined);
      throw err;
    }
  }
}
