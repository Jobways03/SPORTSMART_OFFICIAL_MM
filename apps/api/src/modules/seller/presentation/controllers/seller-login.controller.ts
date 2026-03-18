import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { SellerLoginDto } from '../dtos/seller-login.dto';
import { LoginSellerUseCase } from '../../application/use-cases/login-seller.use-case';

@Controller('seller/auth')
export class SellerLoginController {
  constructor(private readonly loginSellerUseCase: LoginSellerUseCase) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: SellerLoginDto, @Req() req: Request) {
    const data = await this.loginSellerUseCase.execute({
      identifier: dto.identifier,
      password: dto.password,
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    });

    return {
      success: true,
      message: 'Login successful',
      data,
    };
  }
}
