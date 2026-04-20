import { Injectable, Inject } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { ConflictAppException } from '../../../../core/exceptions';
import { FranchiseRegisterResponseData } from '../../presentation/dtos/franchise-auth-response.dto';
import {
  FranchisePartnerRepository,
  FRANCHISE_PARTNER_REPOSITORY,
} from '../../domain/repositories/franchise.repository.interface';

interface RegisterFranchiseInput {
  ownerName: string;
  businessName: string;
  email: string;
  phoneNumber: string;
  password: string;
}

@Injectable()
export class RegisterFranchiseUseCase {
  constructor(
    @Inject(FRANCHISE_PARTNER_REPOSITORY)
    private readonly franchiseRepo: FranchisePartnerRepository,
    private readonly eventBus: EventBusService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('RegisterFranchiseUseCase');
  }

  async execute(input: RegisterFranchiseInput): Promise<FranchiseRegisterResponseData> {
    const { ownerName, businessName, email, phoneNumber, password } = input;

    // Application-level duplicate checks (for specific error messages)
    const existingByEmail = await this.franchiseRepo.findByEmail(email);
    if (existingByEmail) {
      throw new ConflictAppException('A franchise account with this email already exists');
    }

    const existingByPhone = await this.franchiseRepo.findByPhone(phoneNumber);
    if (existingByPhone) {
      throw new ConflictAppException('A franchise account with this phone number already exists');
    }

    // Hash password with cost factor 12
    const passwordHash = await bcrypt.hash(password, 12);

    // Retry loop to handle franchise code collisions (race condition guard)
    let franchise;
    let retries = 3;
    while (retries > 0) {
      const franchiseCode = await this.franchiseRepo.generateNextFranchiseCode();

      try {
        franchise = await this.franchiseRepo.createFranchise({
          ownerName,
          businessName,
          email,
          phoneNumber,
          passwordHash,
          franchiseCode,
        });
        break;
      } catch (error: any) {
        // DB-level unique constraint fallback (race condition guard)
        if (error?.code === 'P2002') {
          const target = error?.meta?.target;

          // If franchise_code collision, retry with a new code
          if (target?.includes('franchise_code')) {
            retries--;
            if (retries === 0) {
              throw new ConflictAppException('Failed to generate unique franchise code');
            }
            continue;
          }

          if (target?.includes('email')) {
            throw new ConflictAppException('A franchise account with this email already exists');
          }
          if (target?.includes('phone_number')) {
            throw new ConflictAppException('A franchise account with this phone number already exists');
          }
          throw new ConflictAppException('A franchise account with these details already exists');
        }
        throw error;
      }
    }

    // Emit domain event (fire and forget)
    this.eventBus.publish({
      eventName: 'franchise.registered',
      aggregate: 'franchise',
      aggregateId: franchise!.id,
      occurredAt: new Date(),
      payload: { franchiseId: franchise!.id, email: franchise!.email },
    }).catch((err) => {
      this.logger.error(`Failed to publish franchise registration event: ${err}`);
    });

    this.logger.log(`Franchise registered: ${franchise!.id}`);

    return {
      franchiseId: franchise!.id,
      franchiseCode: franchise!.franchiseCode,
      ownerName: franchise!.ownerName,
      businessName: franchise!.businessName,
      email: franchise!.email,
      phoneNumber: franchise!.phoneNumber,
    };
  }
}
