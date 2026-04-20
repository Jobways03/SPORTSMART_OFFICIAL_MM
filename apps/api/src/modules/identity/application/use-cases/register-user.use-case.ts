import { Inject, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { ConflictAppException } from '../../../../core/exceptions';
import { RegisterResponseData } from '../../presentation/dtos/auth-response.dto';
import {
  UserRepository,
  USER_REPOSITORY,
} from '../../domain/repositories/user.repository';

interface RegisterInput {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
}

@Injectable()
export class RegisterUserUseCase {
  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepo: UserRepository,
    private readonly eventBus: EventBusService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('RegisterUserUseCase');
  }

  async execute(input: RegisterInput): Promise<RegisterResponseData> {
    const { firstName, lastName, email, password } = input;

    // Hash password with cost factor 12
    const passwordHash = await bcrypt.hash(password, 12);

    try {
      // Create user + role assignment in transaction
      const user = await this.userRepo.createUserWithRole({
        firstName,
        lastName,
        email,
        passwordHash,
      });

      // Emit domain event (fire and forget)
      this.eventBus.publish({
        eventName: 'identity.user.registered',
        aggregate: 'user',
        aggregateId: user.id,
        occurredAt: new Date(),
        payload: { userId: user.id, email: user.email },
      }).catch((err) => {
        this.logger.error(`Failed to publish registration event: ${err}`);
      });

      this.logger.log(`User registered: ${user.id}`);

      return {
        userId: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
      };
    } catch (error: any) {
      // Prisma unique constraint violation (duplicate email)
      if (error?.code === 'P2002' && error?.meta?.target?.includes('email')) {
        throw new ConflictAppException('An account with this email already exists');
      }
      throw error;
    }
  }
}
