import { Injectable, Inject } from '@nestjs/common';
import {
  USER_REPOSITORY,
  UserRepository,
  UpdateCustomerProfileInput,
} from '../../domain/repositories/user.repository';
import {
  BadRequestAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';

@Injectable()
export class UpdateCustomerProfileUseCase {
  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepo: UserRepository,
  ) {}

  async execute(userId: string, input: UpdateCustomerProfileInput) {
    const existing = await this.userRepo.findCustomerProfile(userId);
    if (!existing) {
      throw new NotFoundAppException('Profile not found');
    }

    const updates: UpdateCustomerProfileInput = {};

    if (input.firstName !== undefined) {
      const trimmed = input.firstName.trim();
      if (!trimmed) throw new BadRequestAppException('First name cannot be empty');
      updates.firstName = trimmed;
    }

    if (input.lastName !== undefined) {
      const trimmed = input.lastName.trim();
      if (!trimmed) throw new BadRequestAppException('Last name cannot be empty');
      updates.lastName = trimmed;
    }

    if (input.email !== undefined) {
      const trimmed = input.email.trim().toLowerCase();
      if (!trimmed) throw new BadRequestAppException('Email cannot be empty');
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(trimmed)) {
        throw new BadRequestAppException('Invalid email format');
      }
      if (trimmed !== existing.email) {
        const taken = await this.userRepo.existsByEmailExcept(trimmed, userId);
        if (taken) {
          throw new BadRequestAppException('Email is already in use');
        }
      }
      updates.email = trimmed;
    }

    if (input.phone !== undefined) {
      if (input.phone === null || input.phone === '') {
        updates.phone = null;
      } else {
        const trimmed = input.phone.trim();
        // Allow E.164 (e.g. +919876543210) or 10–15 digits
        const phoneRegex = /^\+?[0-9]{10,15}$/;
        if (!phoneRegex.test(trimmed)) {
          throw new BadRequestAppException('Invalid phone number');
        }
        if (trimmed !== existing.phone) {
          const taken = await this.userRepo.existsByPhoneExcept(trimmed, userId);
          if (taken) {
            throw new BadRequestAppException('Phone is already in use');
          }
        }
        updates.phone = trimmed;
      }
    }

    if (Object.keys(updates).length === 0) {
      return existing;
    }

    return this.userRepo.updateCustomerProfile(userId, updates);
  }
}
