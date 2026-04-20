import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SellerRegisterDto } from '../dtos/seller-register.dto';
import { RegisterSellerUseCase } from '../../application/use-cases/register-seller.use-case';

@ApiTags('Seller Auth')
@Controller('seller/auth')
export class SellerRegisterController {
  constructor(private readonly registerSellerUseCase: RegisterSellerUseCase) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() dto: SellerRegisterDto) {
    const data = await this.registerSellerUseCase.execute({
      sellerName: dto.sellerName,
      sellerShopName: dto.sellerShopName,
      email: dto.email,
      phoneNumber: dto.phoneNumber,
      password: dto.password,
    });

    return {
      success: true,
      message: 'Seller registered successfully',
      data,
    };
  }
}
