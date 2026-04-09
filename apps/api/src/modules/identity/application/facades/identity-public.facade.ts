import { Inject, Injectable } from '@nestjs/common';
import {
  UserRepository,
  USER_REPOSITORY,
} from '../../domain/repositories/user.repository';
import { PermissionCheckService } from '../services/permission-check.service';

@Injectable()
export class IdentityPublicFacade {
  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepo: UserRepository,
    private readonly permissionService: PermissionCheckService,
  ) {}

  async getActorById(userId: string) {
    return this.userRepo.findById(userId);
  }

  async getActorRoles(userId: string): Promise<string[]> {
    return this.permissionService.getUserRoles(userId);
  }

  async validateActorActiveStatus(userId: string): Promise<boolean> {
    const user = await this.userRepo.findById(userId) as any;
    return user?.status === 'ACTIVE';
  }

  async validatePermission(userId: string, permission: string): Promise<boolean> {
    return this.permissionService.hasPermission(userId, permission);
  }

  async getSessionContext(sessionId: string) {
    // Will be implemented in Phase 1
    return null;
  }
}
