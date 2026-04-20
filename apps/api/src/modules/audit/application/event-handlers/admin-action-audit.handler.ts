import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { DomainEvent } from '../../../../bootstrap/events/domain-event.interface';

@Injectable()
export class AdminActionAuditHandler {
  private readonly logger = new Logger(AdminActionAuditHandler.name);

  constructor(private readonly prisma: PrismaService) {}

  @OnEvent('admin.action.*')
  async handleAdminAction(event: DomainEvent): Promise<void> {
    try {
      const { adminId, actionType, sellerId, reason, metadata } = event.payload as any;

      await this.prisma.adminActionAuditLog.create({
        data: {
          adminId: adminId || event.aggregateId,
          actionType: actionType || event.eventName,
          sellerId: sellerId ?? null,
          reason: reason ?? null,
          metadata: metadata || (event.payload as any),
          ipAddress: (event.payload as any)?.ipAddress ?? null,
          userAgent: (event.payload as any)?.userAgent ?? null,
        },
      });

      this.logger.log(`Admin action audited: ${event.eventName}`);
    } catch (error) {
      this.logger.error(`Admin action audit failed: ${(error as Error).message}`);
    }
  }
}
