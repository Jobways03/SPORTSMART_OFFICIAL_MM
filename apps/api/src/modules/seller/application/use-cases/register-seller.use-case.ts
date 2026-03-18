import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { ConflictAppException } from '../../../../core/exceptions';
import { SellerRegisterResponseData } from '../../presentation/dtos/seller-auth-response.dto';

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
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('RegisterSellerUseCase');
  }

  async execute(input: RegisterSellerInput): Promise<SellerRegisterResponseData> {
    const { sellerName, sellerShopName, email, phoneNumber, password } = input;

    // Application-level duplicate checks (for specific error messages)
    const existingByEmail = await this.prisma.seller.findUnique({ where: { email } });
    if (existingByEmail) {
      throw new ConflictAppException('A seller account with this email already exists');
    }

    const existingByPhone = await this.prisma.seller.findUnique({ where: { phoneNumber } });
    if (existingByPhone) {
      throw new ConflictAppException('A seller account with this phone number already exists');
    }

    // Hash password with cost factor 12
    const passwordHash = await bcrypt.hash(password, 12);

    try {
      const seller = await this.prisma.seller.create({
        data: {
          sellerName,
          sellerShopName,
          email,
          phoneNumber,
          passwordHash,
        },
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
