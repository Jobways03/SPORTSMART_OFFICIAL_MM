import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../bootstrap/database/prisma.service';
import { EnvService } from '../../bootstrap/env/env.service';
import { EventBusService } from '../../bootstrap/events/event-bus.service';
import { LeaderElectedCron } from '../../bootstrap/scheduler/leader-elected-cron';
import { ALL_PERMISSION_KEYS, PermissionKey } from './permission-registry';

/**
 * RBAC drift detector.
 *
 * Background: the code-side `PERMISSIONS` registry is the source of
 * truth for what permission keys exist. Custom roles in the DB
 * (`admin_custom_role_permissions`) reference those keys by string.
 * When a key is renamed or removed in code, the DB rows still carry
 * the old string — silent drift. The PermissionsGuard would simply
 * never match the old key, so a custom role thinks it grants something
 * it doesn't, and there's no signal anywhere.
 *
 * This cron sweeps once per day:
 *   1. Loads every distinct `permissionKey` from
 *      `admin_custom_role_permissions`.
 *   2. Diffs against `ALL_PERMISSION_KEYS` from the registry.
 *   3. Emits `rbac.orphan_permission_detected` for each stale row.
 *   4. Logs a summary count for ops visibility.
 *
 * Does NOT auto-delete the rows — that's a destructive action that
 * needs human review. The event lands in the outbox where alerting
 * picks it up; ops then either rename the code key, restore it, or
 * manually remove the DB row.
 *
 * Enabled via env `RBAC_ORPHAN_SWEEP_ENABLED` (default true — this
 * is a read-only sweep with no money-moving side effects, so the
 * cost of running it is essentially nil).
 */
@Injectable()
export class RbacOrphanSweepCron {
  private readonly logger = new Logger(RbacOrphanSweepCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly eventBus: EventBusService,
    private readonly leader: LeaderElectedCron,
  ) {}

  enabled(): boolean {
    return this.env.getBoolean('RBAC_ORPHAN_SWEEP_ENABLED', true);
  }

  // Daily at 03:30 — well after settlement crons (3am) so the locks
  // don't compete.
  @Cron('30 3 * * *')
  async run(): Promise<void> {
    if (!this.enabled()) return;
    await this.leader.run('rbac-orphan-sweep', 30 * 60, async () => {
      await this.runOnce();
    });
  }

  async runOnce(): Promise<void> {
    const validKeys = new Set<string>(ALL_PERMISSION_KEYS);

    // Load all custom-role permission rows. The table is small
    // (one row per role-permission pairing across all custom roles)
    // so a full scan is cheap; aggregation in JS keeps the Prisma
    // typing straightforward and avoids the groupBy generic shape.
    let allRows: Array<{ permissionKey: string }>;
    try {
      allRows = await this.prisma.adminCustomRolePermission.findMany({
        select: { permissionKey: true },
      });
    } catch (err) {
      this.logger.error(
        `Failed to load custom-role permission keys: ${(err as Error).message}`,
      );
      return;
    }

    const counts = new Map<string, number>();
    for (const row of allRows) {
      counts.set(row.permissionKey, (counts.get(row.permissionKey) ?? 0) + 1);
    }
    const dbKeys = Array.from(counts.entries()).map(([permissionKey, n]) => ({
      permissionKey,
      _count: { _all: n },
    }));

    const orphans = dbKeys.filter((row) => !validKeys.has(row.permissionKey));

    if (orphans.length === 0) {
      this.logger.log(
        `RBAC sweep clean — ${dbKeys.length} distinct permission keys, all valid.`,
      );
      return;
    }

    for (const o of orphans) {
      try {
        await this.eventBus.publish({
          eventName: 'rbac.orphan_permission_detected',
          aggregate: 'AdminCustomRolePermission',
          aggregateId: o.permissionKey,
          occurredAt: new Date(),
          payload: {
            permissionKey: o.permissionKey,
            rowCount: o._count._all,
            note:
              'A custom-role binding references a permission key that no longer exists in the code registry. Either restore the key in PERMISSIONS or manually remove the DB row.',
          },
        });
      } catch (err) {
        this.logger.warn(
          `Failed to publish orphan event for ${o.permissionKey}: ${(err as Error).message}`,
        );
      }
    }

    this.logger.warn(
      `RBAC sweep: ${orphans.length} orphan permission key(s) detected: ${orphans
        .map((o) => `${o.permissionKey} (${o._count._all} bindings)`)
        .join(', ')}`,
    );
  }

  /** Exposed for unit tests + ad-hoc invocation via admin tooling. */
  getValidKeys(): readonly PermissionKey[] {
    return ALL_PERMISSION_KEYS;
  }
}
