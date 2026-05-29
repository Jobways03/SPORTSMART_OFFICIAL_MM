// Phase 23 GST — TaxModeService.
//
// Single source of truth for the two-stage flag rollout that takes the
// GST module from dev-permissive to prod-strict. Three modes exist
// (mutually layered; strict implies audit):
//
//   OFF      — tax_audit_mode=false, tax_strict_mode=false.
//              Permissive: missing HSN / rate / GSTIN data passes through
//              with a fallback (Phase 8 picker, Phase 3 default rate).
//              Used in dev / test so engineers don't have to hand-seed
//              every product before exercising the order flow.
//
//   AUDIT    — tax_audit_mode=true, tax_strict_mode=false.
//              Validation runs but failures are LOGGED (with a clear
//              `tax_audit.violation` shape) rather than thrown. Lets
//              CA-staging soak through real traffic without blocking
//              checkouts, gathering data on which products / sellers
//              would fail strict mode.
//
//   STRICT   — tax_strict_mode=true (audit_mode is implied true).
//              Validation throws on missing required data. The DRAFT
//              banner is suppressed on PDF renders. Used in prod once
//              CA has signed off on the audit results.
//
// Source of truth: `tax_config` table (CA-tunable via the admin
// settings panel). Env vars `TAX_STRICT_MODE` / `TAX_AUDIT_MODE` are
// boot-time fallbacks when the config row hasn't been seeded yet.
//
// All reads cache via TaxConfigService's 60-second TTL — the service
// is hot-path safe.

import { Injectable, Logger, Optional } from '@nestjs/common';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';
import { TaxConfigService } from './tax-config.service';

export type TaxMode = 'OFF' | 'AUDIT' | 'STRICT';

// Phase 159w (audit B3/#9/#16) — centralised audit action + module for tax-mode
// changes. The admin History UI queries
// /admin/audit?module=tax-mode (action TAX_MODE_CHANGED); keep these in lockstep.
export const TAX_MODE_AUDIT_ACTION = 'TAX_MODE_CHANGED';
export const TAX_MODE_AUDIT_MODULE = 'tax-mode';

export interface TaxModeInfo {
  mode: TaxMode;
  /**
   * Phase 159w (audit #14) — 'db' when a tax_config row drives the mode; 'env'
   * when only the boot-time env fallback is in effect (no rows seeded). Lets
   * the admin UI warn "mode is coming from env, not the DB you're editing."
   */
  source: 'db' | 'env';
}

export interface SetTaxModeOptions {
  reason?: string | null;
  /** True when an admin overrode the AUDIT-readiness gate to enter STRICT. */
  forced?: boolean;
  /** TaxAuditReadinessService.totalBlockers at flip time (for the history row). */
  blockerCount?: number;
}

export interface TaxModeViolation {
  /** Logical group — e.g. 'product.hsn', 'seller.gstin', 'invoice.rate'. */
  code: string;
  /** Human-readable message captured in audit logs + thrown errors. */
  message: string;
  /** Optional structured context for the audit log consumer. */
  context?: Record<string, unknown>;
}

export class TaxStrictModeViolationError extends Error {
  constructor(public readonly violation: TaxModeViolation) {
    super(`TaxStrictMode: ${violation.code} — ${violation.message}`);
    this.name = 'TaxStrictModeViolationError';
  }
}

@Injectable()
export class TaxModeService {
  private readonly logger = new Logger(TaxModeService.name);

  constructor(
    private readonly env: EnvService,
    private readonly taxConfig: TaxConfigService,
    private readonly prisma: PrismaService,
    // @Optional so the many specs that construct this service directly keep
    // compiling; both are @Global and always injected in the running app.
    @Optional() private readonly eventBus?: EventBusService,
    @Optional() private readonly audit?: AuditPublicFacade,
  ) {}

  /**
   * Read the current mode. Phase 159w (audit #7): the authoritative single
   * `tax_mode` key wins; we fall back to the legacy two-flag derivation (and
   * its env boot-time defaults) only when the key isn't set — so pre-159w
   * deployments and the place-of-supply flag reader keep working unchanged.
   */
  async getMode(): Promise<TaxMode> {
    const explicit = await this.taxConfig.getString('tax_mode', '');
    if (explicit === 'OFF' || explicit === 'AUDIT' || explicit === 'STRICT') {
      return explicit;
    }
    const strictDefault = this.env.getBoolean(
      'TAX_STRICT_MODE' as any,
      false,
    );
    const auditDefault = this.env.getBoolean(
      'TAX_AUDIT_MODE' as any,
      false,
    );
    const [strict, audit] = await Promise.all([
      this.taxConfig.getBoolean('tax_strict_mode', strictDefault),
      this.taxConfig.getBoolean('tax_audit_mode', auditDefault),
    ]);
    if (strict) return 'STRICT';
    if (audit) return 'AUDIT';
    return 'OFF';
  }

  /**
   * Phase 159w (audit #14) — mode + where it came from. `source: 'env'` means
   * no tax_config rows are seeded and the env defaults are in effect, which the
   * admin UI surfaces so a "DB shows empty but API says STRICT" mismatch is
   * explained rather than mysterious.
   */
  async getModeInfo(): Promise<TaxModeInfo> {
    const mode = await this.getMode();
    const rowCount = await this.prisma.taxConfig.count({
      where: { key: { in: ['tax_mode', 'tax_strict_mode', 'tax_audit_mode'] } },
    });
    return { mode, source: rowCount > 0 ? 'db' : 'env' };
  }

  /**
   * Flip the mode. Writes both flags atomically (STRICT implies AUDIT
   * per the boot semantics) and invalidates the TaxConfigService cache
   * so the new mode is picked up immediately rather than after the 60s
   * TTL. The actorId is logged for the audit trail; the change shows up
   * in the next mode-read.
   *
   * Persistence model: two rows in `tax_config` — `tax_audit_mode` and
   * `tax_strict_mode` — boolean strings ('true' / 'false'). Mode → flags
   * mapping:
   *   OFF    → audit=false, strict=false
   *   AUDIT  → audit=true,  strict=false
   *   STRICT → audit=true,  strict=true   (strict implies audit)
   */
  async setMode(
    mode: TaxMode,
    actorId?: string | null,
    opts?: SetTaxModeOptions,
  ): Promise<{ from: TaxMode; to: TaxMode }> {
    const from = await this.getMode();
    const auditFlag = mode === 'AUDIT' || mode === 'STRICT';
    const strictFlag = mode === 'STRICT';
    const description = `Tax mode (managed via admin UI)`;
    const updatedBy = actorId ?? null;

    // Phase 159w (audit #3/#7/#8) — the authoritative `tax_mode` key, both
    // back-compat flags, and the append-only history row are written in ONE
    // transaction. The single key is the source of truth, so two concurrent
    // setMode calls can no longer interleave the two flags into an "invented"
    // mixed mode (#7) — the last committed `tax_mode` wins, consistently.
    await this.prisma.$transaction([
      this.prisma.taxConfig.upsert({
        where: { key: 'tax_mode' },
        update: { value: mode, description, updatedBy },
        create: { key: 'tax_mode', value: mode, description, updatedBy },
      }),
      this.prisma.taxConfig.upsert({
        where: { key: 'tax_audit_mode' },
        update: { value: auditFlag, description, updatedBy },
        create: { key: 'tax_audit_mode', value: auditFlag, description, updatedBy },
      }),
      this.prisma.taxConfig.upsert({
        where: { key: 'tax_strict_mode' },
        update: { value: strictFlag, description, updatedBy },
        create: { key: 'tax_strict_mode', value: strictFlag, description, updatedBy },
      }),
      this.prisma.gstModeHistory.create({
        data: {
          fromMode: from,
          toMode: mode,
          actorId: actorId ?? null,
          reason: opts?.reason ?? null,
          forced: opts?.forced ?? false,
          blockerCount: opts?.blockerCount ?? 0,
        },
      }),
    ]);

    this.taxConfig.invalidate('tax_mode');
    this.taxConfig.invalidate('tax_audit_mode');
    this.taxConfig.invalidate('tax_strict_mode');

    this.logger.log(
      `Tax mode ${from} → ${mode} (audit=${auditFlag}, strict=${strictFlag}) by ` +
        `${actorId ?? 'system'}` +
        (opts?.forced ? ` [FORCED over ${opts?.blockerCount ?? 0} blockers]` : ''),
    );

    // Phase 159w (audit #8) — let downstream caches / consumers react.
    try {
      await this.eventBus?.publish({
        eventName: 'tax.mode.changed',
        aggregate: 'TaxConfig',
        aggregateId: 'tax_mode',
        occurredAt: new Date(),
        payload: {
          from,
          to: mode,
          actorId: actorId ?? null,
          forced: opts?.forced ?? false,
        },
      });
    } catch (err) {
      this.logger.error(
        `tax.mode.changed publish failed: ${(err as Error)?.message}`,
      );
    }

    // Phase 159w (audit B3/#3/#16) — compliance audit row. GstModeHistory above
    // is the durable record; this mirrors it into the cross-cutting audit log
    // the admin History UI reads. Awaited, but an audit-write blip must not
    // undo the already-committed mode flip — log and continue.
    try {
      await this.audit?.writeAuditLog({
        actorId: actorId ?? 'system',
        action: TAX_MODE_AUDIT_ACTION,
        module: TAX_MODE_AUDIT_MODULE,
        resource: 'tax_mode',
        resourceId: 'tax_mode',
        oldValue: { mode: from },
        newValue: { mode },
        metadata: {
          reason: opts?.reason ?? null,
          forced: opts?.forced ?? false,
          blockerCount: opts?.blockerCount ?? 0,
        },
      });
    } catch (err) {
      this.logger.error(
        `TAX_MODE_CHANGED audit write failed: ${(err as Error)?.message}`,
      );
    }

    return { from, to: mode };
  }

  async isStrict(): Promise<boolean> {
    return (await this.getMode()) === 'STRICT';
  }

  async isAuditOrStrict(): Promise<boolean> {
    const m = await this.getMode();
    return m === 'AUDIT' || m === 'STRICT';
  }

  /**
   * Apply a violation per the current mode:
   *   OFF    — silent (return null; engineering opted out).
   *   AUDIT  — log a structured `tax_audit.violation` line; return the
   *            violation so the caller can attach to its outcome.
   *   STRICT — throw `TaxStrictModeViolationError`.
   *
   * Caller decides whether to skip work (OFF), proceed with warning
   * (AUDIT), or stop entirely (STRICT) based on the returned value.
   */
  async report(
    violation: TaxModeViolation,
  ): Promise<TaxModeViolation | null> {
    const mode = await this.getMode();
    switch (mode) {
      case 'OFF':
        return null;
      case 'AUDIT':
        this.logger.warn(
          `tax_audit.violation code=${violation.code} message=${violation.message} ` +
            `context=${JSON.stringify(violation.context ?? {})}`,
        );
        return violation;
      case 'STRICT':
        this.logger.error(
          `tax_strict.violation code=${violation.code} message=${violation.message} ` +
            `context=${JSON.stringify(violation.context ?? {})}`,
        );
        throw new TaxStrictModeViolationError(violation);
    }
  }

  /**
   * Synchronous helper for hot paths that already have the mode
   * cached (e.g. the PDF template renderer reads the mode at render
   * time and threads it through). Use `getMode()` everywhere else.
   */
  static shouldShowDraftBanner(mode: TaxMode): boolean {
    return mode !== 'STRICT';
  }
}
