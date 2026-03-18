import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { RegisterDto } from '../dtos/register.dto';
import { RegisterUserUseCase } from '../../application/use-cases/register-user.use-case';

@Controller('auth')
export class RegisterController {
  constructor(private readonly registerUseCase: RegisterUserUseCase) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() dto: RegisterDto) {
    const data = await this.registerUseCase.execute({
      firstName: dto.firstName,
      lastName: dto.lastName,
      email: dto.email,
      password: dto.password,
    });

    return {
      success: true,
      message: 'Registration successful',
      data,
    };
  }
}
