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
import { Request } from 'express';
import { FranchiseAuthGuard } from '../../../../core/guards';
import { SendFranchiseEmailVerificationUseCase } from '../../application/use-cases/send-franchise-email-verification.use-case';
import { VerifyFranchiseEmailUseCase } from '../../application/use-cases/verify-franchise-email.use-case';

@ApiTags('Franchise Auth')
@Controller('franchise/profile/verify-email')
@UseGuards(FranchiseAuthGuard)
export class FranchiseEmailVerificationController {
  constructor(
    private readonly sendOtpUseCase: SendFranchiseEmailVerificationUseCase,
    private readonly verifyEmailUseCase: VerifyFranchiseEmailUseCase,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async sendOtp(@Req() req: Request) {
    const franchiseId = (req as any).franchiseId;
    await this.sendOtpUseCase.execute(franchiseId);

    return {
      success: true,
      message: 'Verification OTP sent to your email',
    };
  }

  @Post('confirm')
  @HttpCode(HttpStatus.OK)
  async verify(
    @Req() req: Request,
    @Body() body: { otp: string },
  ) {
    const franchiseId = (req as any).franchiseId;
    const data = await this.verifyEmailUseCase.execute({
      franchiseId,
      otp: body.otp,
    });

    return {
      success: true,
      message: 'Email verified successfully',
      data,
    };
  }
}
