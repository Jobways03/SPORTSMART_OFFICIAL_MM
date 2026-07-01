import { Module } from '@nestjs/common';
import { ContactController } from './presentation/controllers/contact.controller';
import { ContactService } from './application/services/contact.service';

/**
 * Public "Contact us" module. EmailService, EnvService, AppLoggerService and
 * CaptchaVerifierService all come from @Global modules, so nothing needs to be
 * imported here.
 */
@Module({
  controllers: [ContactController],
  providers: [ContactService],
})
export class ContactModule {}
