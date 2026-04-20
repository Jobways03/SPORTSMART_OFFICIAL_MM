import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { DomainEvent } from '../../../../bootstrap/events/domain-event.interface';

@Injectable()
export class CodAuditHandler {
  private readonly logger = new Logger(CodAuditHandler.name);

  constructor(private readonly prisma: PrismaService) {}

  @OnEvent('cod.decision.logged')
  async handleDecisionLogged(event: DomainEvent): Promise<void> {
    await this.logEvent(event);
  }

  @OnEvent('cod.rule.updated')
  async handleRuleUpdated(event: DomainEvent): Promise<void> {
    await this.logEvent(event);
  }

  private async logEvent(event: DomainEvent): Promise<void> {
    try {
      await this.prisma.eventLog.create({
        data: {
          eventName: event.eventName,
          aggregate: event.aggregate,
          aggregateId: event.aggregateId,
          payload: event.payload as any,
          publishedAt: event.occurredAt,
        },
      });

      this.logger.log(`COD audit logged: ${event.eventName}`);
    } catch (error) {
      this.logger.error(`COD audit logging failed: ${(error as Error).message}`);
    }
  }
}
