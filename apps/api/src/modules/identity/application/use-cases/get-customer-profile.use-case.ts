import { Injectable, Inject } from '@nestjs/common';
import {
  USER_REPOSITORY,
  UserRepository,
} from '../../domain/repositories/user.repository';
import { NotFoundAppException } from '../../../../core/exceptions';

@Injectable()
export class GetCustomerProfileUseCase {
  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepo: UserRepository,
  ) {}

  async execute(userId: string) {
    const profile = await this.userRepo.findCustomerProfile(userId);
    if (!profile) {
      throw new NotFoundAppException('Profile not found');
    }
    return profile;
  }
}
