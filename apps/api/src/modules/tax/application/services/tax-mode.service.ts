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

import { Injectable, Logger } from '@nestjs/common';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { TaxConfigService } from './tax-config.service';

export type TaxMode = 'OFF' | 'AUDIT' | 'STRICT';

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
  ) {}

  /**
   * Read the current mode. tax_config takes precedence; env is the
   * boot-time fallback when the row is missing.
   */
  async getMode(): Promise<TaxMode> {
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
