import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../bootstrap/database/prisma.service';
import { EventBusService } from '../../../bootstrap/events/event-bus.service';

/**
 * Phase 6 (PR 6.2) — escalation strategies for SLA-breached cases.
 *
 * Three tactics, picked by SlaPolicy.escalateAction:
 *
 *   - REASSIGN_SENIOR: clear assigned_admin_id so the case re-enters
 *     the unassigned queue; senior reviewers monitor that queue.
 *     We don't pick a specific senior — the queue UI handles routing.
 *
 *   - BOOST_SEVERITY: only meaningful for disputes (severity 1-100
 *     drives queue order). We bump to 95 so the case rises near the
 *     top, but stay below 100 to leave headroom for human-flagged
 *     "this is a fire" cases.
 *
 *   - NOTIFY_MANAGER: emit a notifications event the comms module
 *     handles. Used when the right action is "tell a human" not "do
 *     something automated".
 *
 * Unknown actions log a warning and skip — defensive against typo'd
 * policies.
 */
@Injectable()
export class SlaEscalationService {
  private readonly logger = new Logger(SlaEscalationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
  ) {}

  async escalate(input: {
    resourceType: string;
    resourceId: string;
    action: string;
    policyName: string;
  }): Promise<void> {
    switch (input.action) {
      case 'REASSIGN_SENIOR':
        await this.reassignSenior(input);
        return;
      case 'BOOST_SEVERITY':
        await this.boostSeverity(input);
        return;
      case 'NOTIFY_MANAGER':
        await this.notifyManager(input);
        return;
      default:
        this.logger.warn(
          `SLA escalate skipped: unknown action "${input.action}" on ${input.resourceType} ${input.resourceId}`,
        );
    }
  }

  private async reassignSenior(input: {
    resourceType: string;
    resourceId: string;
    policyName: string;
  }): Promise<void> {
    if (input.resourceType === 'dispute') {
      await this.prisma.dispute.update({
        where: { id: input.resourceId },
        data: { assignedAdminId: null },
      });
    } else if (input.resourceType === 'ticket') {
      await this.prisma.ticket.update({
        where: { id: input.resourceId },
        data: { assignedAdminId: null },
      });
    } else if (input.resourceType === 'return') {
      // Returns don't carry an assignedAdminId today — only tier+role
      // permissioning. Boost severity is the closest analogue, but
      // returns also lack a severity column. Emit a notification so
      // a senior reviewer picks it up manually.
      await this.notifyManager(input);
      return;
    }
    await this.emitEscalation(input, 'REASSIGN_SENIOR');
  }

  private async boostSeverity(input: {
    resourceType: string;
    resourceId: string;
    policyName: string;
  }): Promise<void> {
    if (input.resourceType !== 'dispute') {
      this.logger.warn(
        `BOOST_SEVERITY only applies to disputes; received ${input.resourceType} ${input.resourceId}`,
      );
      return;
    }
    await this.prisma.dispute.update({
      where: { id: input.resourceId },
      data: { severity: 95 },
    });
    await this.emitEscalation(input, 'BOOST_SEVERITY');
  }

  private async notifyManager(input: {
    resourceType: string;
    resourceId: string;
    policyName: string;
  }): Promise<void> {
    await this.emitEscalation(input, 'NOTIFY_MANAGER');
  }

  private async emitEscalation(
    input: {
      resourceType: string;
      resourceId: string;
      policyName: string;
    },
    action: string,
  ): Promise<void> {
    try {
      await this.eventBus.publish({
        eventName: 'sla.escalated',
        aggregate: input.resourceType,
        aggregateId: input.resourceId,
        occurredAt: new Date(),
        payload: {
          resourceType: input.resourceType,
          resourceId: input.resourceId,
          action,
          policyName: input.policyName,
        },
      });
    } catch (err) {
      this.logger.warn(
        `Failed to publish sla.escalated for ${input.resourceType} ${input.resourceId}: ${(err as Error).message}`,
      );
    }
  }
}
