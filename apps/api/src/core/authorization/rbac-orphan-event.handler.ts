import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DomainEvent } from '../../bootstrap/events/domain-event.interface';
import { AuditPublicFacade } from '../../modules/audit/application/facades/audit-public.facade';

/**
 * Phase 24 (2026-05-20) — RBAC orphan event consumer.
 *
 * RbacOrphanSweepCron emits `rbac.orphan_permission_detected` for
 * every custom-role permission key that no longer exists in the
 * code-side registry. Pre-Phase-24 nothing listened — the event sat
 * in the outbox, never alerting anyone, and drift accumulated until
 * a customer-impact incident surfaced it.
 *
 * This handler:
 *   1. Logs at WARN with structured detail so the log shipper
 *      surfaces it to whatever alerting backend the deployment uses
 *      (Slack, PagerDuty, Sentry).
 *   2. Writes a row to the unified AuditLog so an operator looking
 *      at recent admin/security activity sees the drift in the same
 *      surface as authorization denials.
 *
 * Does NOT delete the orphan row — that's a destructive action that
 * stays manual. Ops review the drift, either restore the registry
 * key or rename it in DB, then re-run the cron.
 */
@Injectable()
export class RbacOrphanEventHandler {
  private readonly logger = new Logger(RbacOrphanEventHandler.name);

  constructor(private readonly audit: AuditPublicFacade) {}

  @OnEvent('rbac.orphan_permission_detected')
  async onOrphanDetected(
    event: DomainEvent<{
      permissionKey: string;
      rowCount: number;
      note: string;
    }>,
  ) {
    const { permissionKey, rowCount, note } = event.payload;
    this.logger.warn(
      JSON.stringify({
        event: 'rbac.orphan_permission_detected',
        permissionKey,
        rowCount,
        note,
      }),
    );
    this.audit
      .writeAuditLog({
        actorRole: 'SYSTEM',
        action: 'rbac.orphan_permission_detected',
        module: 'authorization',
        resource: 'AdminCustomRolePermission',
        resourceId: permissionKey,
        newValue: { permissionKey, rowCount, note },
      })
      .catch(() => undefined);
  }
}
