import { Inject, Injectable } from '@nestjs/common';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import {
  AdminRepository,
  ADMIN_REPOSITORY,
} from '../../domain/repositories/admin.repository.interface';

interface AuditEntry {
  adminId: string;
  sellerId?: string;
  actionType: string;
  oldValue?: Record<string, unknown>;
  newValue?: Record<string, unknown>;
  reason?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class AdminAuditService {
  constructor(
    @Inject(ADMIN_REPOSITORY)
    private readonly adminRepo: AdminRepository,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('AdminAuditService');
  }

  async log(entry: AuditEntry): Promise<void> {
    try {
      await this.adminRepo.createAuditLog({
        adminId: entry.adminId,
        sellerId: entry.sellerId || null,
        actionType: entry.actionType,
        oldValue: entry.oldValue ? JSON.parse(JSON.stringify(entry.oldValue)) : undefined,
        newValue: entry.newValue ? JSON.parse(JSON.stringify(entry.newValue)) : undefined,
        reason: entry.reason || null,
        metadata: entry.metadata ? JSON.parse(JSON.stringify(entry.metadata)) : undefined,
        ipAddress: entry.ipAddress || null,
        userAgent: entry.userAgent || null,
      });
    } catch (err) {
      this.logger.error(`Failed to write audit log: ${err}`);
    }
  }
}
