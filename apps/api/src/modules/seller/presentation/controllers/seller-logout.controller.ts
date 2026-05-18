import {
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { SellerAuthGuard } from '../../../../core/guards';
import { LogoutSellerUseCase } from '../../application/use-cases/logout-seller.use-case';

@ApiTags('Seller Auth')
@Controller('seller/auth')
@UseGuards(SellerAuthGuard)
export class SellerLogoutController {
  constructor(private readonly logoutUseCase: LogoutSellerUseCase) {}

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Req() req: Request) {
    const sellerId = (req as unknown as { sellerId?: string }).sellerId;
    if (!sellerId) {
      throw new UnauthorizedException('Seller session not found');
    }
    await this.logoutUseCase.execute(sellerId);
    return {
      success: true,
      message: 'Logged out successfully. All active sessions for this account have been revoked.',
    };
  }
}
