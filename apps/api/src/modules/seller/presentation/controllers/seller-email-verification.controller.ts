import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { SellerAuthGuard } from '../../infrastructure/guards/seller-auth.guard';
import { SendEmailVerificationOtpUseCase } from '../../application/use-cases/send-email-verification-otp.use-case';
import { VerifySellerEmailUseCase } from '../../application/use-cases/verify-seller-email.use-case';

@Controller('seller/profile/verify-email')
@UseGuards(SellerAuthGuard)
export class SellerEmailVerificationController {
  constructor(
    private readonly sendOtpUseCase: SendEmailVerificationOtpUseCase,
    private readonly verifyEmailUseCase: VerifySellerEmailUseCase,
  ) {}

  @Post('send-otp')
  @HttpCode(HttpStatus.OK)
  async sendOtp(@Req() req: Request) {
    const sellerId = (req as any).sellerId;
    await this.sendOtpUseCase.execute(sellerId);

    return {
      success: true,
      message: 'Verification OTP sent to your email',
    };
  }

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  async verify(
    @Req() req: Request,
    @Body() body: { otp: string },
  ) {
    const sellerId = (req as any).sellerId;
    const data = await this.verifyEmailUseCase.execute({
      sellerId,
      otp: body.otp,
    });

    return {
      success: true,
      message: 'Email verified successfully',
      data,
    };
  }
}
