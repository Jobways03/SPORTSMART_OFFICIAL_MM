import { Inject, Injectable } from '@nestjs/common';
import {
  UserRepository,
  USER_REPOSITORY,
} from '../../domain/repositories/user.repository';

@Injectable()
export class PermissionCheckService {
  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepo: UserRepository,
  ) {}

  async getUserRoles(userId: string): Promise<string[]> {
    return this.userRepo.getUserRoles(userId);
  }

  async hasPermission(userId: string, permissionCode: string): Promise<boolean> {
    return this.userRepo.hasPermission(userId, permissionCode);
  }
}
