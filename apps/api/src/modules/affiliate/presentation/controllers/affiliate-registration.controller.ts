import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AffiliateRegistrationService } from '../../application/services/affiliate-registration.service';
import { RegisterAffiliateDto } from '../dtos/register-affiliate.dto';

/**
 * Public affiliate registration. No auth — anyone can apply. The
 * application lands as PENDING_APPROVAL; admin review (separate
 * endpoint) flips to ACTIVE.
 */
@ApiTags('Affiliate')
@Controller('affiliate')
export class AffiliateRegistrationController {
  constructor(
    private readonly registrationService: AffiliateRegistrationService,
  ) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() dto: RegisterAffiliateDto) {
    const data = await this.registrationService.register(dto);
    return {
      success: true,
      message:
        'Application submitted successfully. We will review and notify you shortly.',
      data,
    };
  }
}
