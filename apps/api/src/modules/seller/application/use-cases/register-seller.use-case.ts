import { Injectable, Inject } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { ConflictAppException } from '../../../../core/exceptions';
import { SellerRegisterResponseData } from '../../presentation/dtos/seller-auth-response.dto';
import {
  SellerRepository,
  SELLER_REPOSITORY,
} from '../../domain/repositories/seller.repository.interface';
import { SendEmailVerificationOtpUseCase } from './send-email-verification-otp.use-case';

interface RegisterSellerInput {
  sellerName: string;
  sellerShopName: string;
  email: string;
  phoneNumber: string;
  password: string;
}

@Injectable()
export class RegisterSellerUseCase {
  constructor(
    @Inject(SELLER_REPOSITORY)
    private readonly sellerRepo: SellerRepository,
    private readonly eventBus: EventBusService,
    private readonly logger: AppLoggerService,
    private readonly sendEmailVerificationOtp: SendEmailVerificationOtpUseCase,
  ) {
    this.logger.setContext('RegisterSellerUseCase');
  }

  async execute(input: RegisterSellerInput): Promise<SellerRegisterResponseData> {
    const { sellerName, sellerShopName, email, phoneNumber, password } = input;

    // Application-level duplicate checks (for specific error messages)
    const existingByEmail = await this.sellerRepo.findByEmail(email);
    if (existingByEmail) {
      throw new ConflictAppException('A seller account with this email already exists');
    }

    const existingByPhone = await this.sellerRepo.findByPhone(phoneNumber);
    if (existingByPhone) {
      throw new ConflictAppException('A seller account with this phone number already exists');
    }

    // Hash password with cost factor 12
    const passwordHash = await bcrypt.hash(password, 12);

    try {
      const seller = await this.sellerRepo.createSeller({
        sellerName,
        sellerShopName,
        email,
        phoneNumber,
        passwordHash,
      });

      // Emit domain event (fire and forget)
      this.eventBus.publish({
        eventName: 'seller.registered',
        aggregate: 'seller',
        aggregateId: seller.id,
        occurredAt: new Date(),
        payload: { sellerId: seller.id, email: seller.email },
      }).catch((err) => {
        this.logger.error(`Failed to publish seller registration event: ${err}`);
      });

      // Auto-send email-verification OTP so the seller can verify in
      // the same flow without an extra click. Fire-and-forget: SMTP
      // problems shouldn't fail registration — the seller can request
      // a re-send from the verify-email screen if the first send failed.
      this.sendEmailVerificationOtp
        .execute(seller.id)
        .catch((err) => {
          this.logger.error(
            `Failed to send email verification OTP at registration for seller ${seller.id}: ${err}`,
          );
        });

      this.logger.log(`Seller registered: ${seller.id}`);

      return {
        sellerId: seller.id,
        sellerName: seller.sellerName,
        sellerShopName: seller.sellerShopName,
        email: seller.email,
        phoneNumber: seller.phoneNumber,
      };
    } catch (error: any) {
      // DB-level unique constraint fallback (race condition guard)
      if (error?.code === 'P2002') {
        const target = error?.meta?.target;
        if (target?.includes('email')) {
          throw new ConflictAppException('A seller account with this email already exists');
        }
        if (target?.includes('phone_number')) {
          throw new ConflictAppException('A seller account with this phone number already exists');
        }
        throw new ConflictAppException('A seller account with these details already exists');
      }
      throw error;
    }
  }
}
