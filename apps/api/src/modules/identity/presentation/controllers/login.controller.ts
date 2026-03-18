import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { LoginDto } from '../dtos/login.dto';
import { LoginUserUseCase } from '../../application/use-cases/login-user.use-case';

@Controller('auth')
export class LoginController {
  constructor(private readonly loginUseCase: LoginUserUseCase) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto, @Req() req: Request) {
    const data = await this.loginUseCase.execute({
      email: dto.email,
      password: dto.password,
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip || req.socket.remoteAddress,
    });

    return {
      success: true,
      message: 'Login successful',
      data,
    };
  }
}
