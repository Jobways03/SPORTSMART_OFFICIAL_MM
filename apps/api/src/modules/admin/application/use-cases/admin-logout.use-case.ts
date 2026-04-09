import { Inject, Injectable } from '@nestjs/common';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import {
  AdminRepository,
  ADMIN_REPOSITORY,
} from '../../domain/repositories/admin.repository.interface';

@Injectable()
export class AdminLogoutUseCase {
  constructor(
    @Inject(ADMIN_REPOSITORY)
    private readonly adminRepo: AdminRepository,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('AdminLogoutUseCase');
  }

  async execute(adminId: string): Promise<void> {
    // Revoke all active sessions for this admin
    await this.adminRepo.revokeAdminSessions(adminId);

    this.logger.log(`Admin logged out: ${adminId}`);
  }
}
