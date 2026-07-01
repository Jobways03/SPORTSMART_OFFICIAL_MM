import { Public } from '@core/decorators';
import { Body, Controller, HttpCode, HttpStatus, Ip, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ContactDto } from '../dtos/contact.dto';
import { ContactService } from '../../application/services/contact.service';
import { CaptchaVerifierService } from '../../../../integrations/captcha/captcha-verifier.service';

/**
 * Public "Contact us" endpoint (storefront /contact page).
 *
 *   POST /api/v1/contact    5/min/IP, CAPTCHA-guarded
 *
 * Unauthenticated + rate-limited + CAPTCHA-verified — the same protections the
 * seller/customer registration endpoints use, because this endpoint sends email
 * to the support inbox and would otherwise be a spam relay.
 */
@ApiTags('Contact')
@Public()
@Controller('contact')
export class ContactController {
  constructor(
    private readonly contactService: ContactService,
    private readonly captcha: CaptchaVerifierService,
  ) {}

  @Post()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.ACCEPTED)
  async submit(@Body() dto: ContactDto, @Ip() ip: string) {
    // Verifies the CAPTCHA when a provider is configured; short-circuits (no-op)
    // when CAPTCHA is disabled (dev/staging default), so no token is required.
    await this.captcha.verify(dto.captchaToken, ip);

    await this.contactService.submit(dto);

    return {
      success: true,
      message: 'Thanks for reaching out — your message has been sent to our team.',
    };
  }
}
