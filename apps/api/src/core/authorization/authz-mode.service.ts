import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { EnvService } from '../../bootstrap/env/env.service';
import { PrismaService } from '../../bootstrap/database/prisma.service';

export interface AuthzModeOverride {
  strictMode?: boolean;
  abacEnabled?: boolean;
  auditEnabled?: boolean;
}

const SETTING_KEY = 'authz.mode';

/**
 * Resolves the EFFECTIVE authorization-mode flags (strict / abac / audit).
 *
 * effective = env baseline OR runtime DB override. The OR is deliberate and
 * is the security invariant: a runtime override (set via POST /admin/authz/
 * mode) can only TIGHTEN enforcement — turn strict/abac/audit ON early —
 * never drop below what the deployment's env mandates. Disabling a
 * deploy-mandated strict mode still requires an env change + redeploy, so a
 * compromised/malicious admin cannot disable authorization at runtime.
 *
 * The hot-path reads (isStrict/isAbacEnabled/isAuditEnabled) are SYNCHRONOUS
 * — they read an in-memory cache refreshed in the background (every 30s) and
 * immediately on setOverride. So the PermissionsGuard takes no per-request
 * DB round-trip, and a stale/failed cache simply falls back to the env
 * baseline (never weaker than today).
 */
@Injectable()
export class AuthzModeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AuthzModeService.name);
  private override: AuthzModeOverride = {};
  private updatedAt: Date | null = null;
  private updatedByAdminId: string | null = null;
  private timer: NodeJS.Timeout | null = null;
  private static readonly REFRESH_MS = 30_000;

  constructor(
    private readonly env: EnvService,
    private readonly prisma: PrismaService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.refresh();
    this.timer = setInterval(() => void this.refresh(), AuthzModeService.REFRESH_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async refresh(): Promise<void> {
    try {
      const row = await this.prisma.systemSetting.findUnique({ where: { key: SETTING_KEY } });
      this.override = ((row?.value as AuthzModeOverride | null) ?? {}) as AuthzModeOverride;
      this.updatedAt = row?.updatedAt ?? null;
      this.updatedByAdminId = row?.updatedByAdminId ?? null;
    } catch (e) {
      // Keep the last-known override; env baseline still applies, so a DB
      // blip never WEAKENS enforcement.
      this.logger.warn(`Authz mode refresh failed: ${(e as Error).message}`);
    }
  }

  // ── Effective flags (synchronous hot-path; tighten-only) ──────────

  isStrict(): boolean {
    return this.env.getBoolean('PERMISSIONS_GUARD_STRICT', false) || this.override.strictMode === true;
  }

  isAbacEnabled(): boolean {
    return this.env.getBoolean('ABAC_ENABLED', false) || this.override.abacEnabled === true;
  }

  isAuditEnabled(): boolean {
    return this.env.getBoolean('AUTHZ_AUDIT_ENABLED', true) || this.override.auditEnabled === true;
  }

  // ── Mutation (mode-change endpoint) ───────────────────────────────

  /**
   * Persist a runtime override and refresh the local cache immediately.
   * Returns the validated, effective override. Callers MUST gate this
   * behind SUPER_ADMIN + audit.
   */
  async setOverride(
    patch: AuthzModeOverride,
    adminId: string | null,
  ): Promise<AuthzModeOverride> {
    const next: AuthzModeOverride = { ...this.override };
    // Only accept boolean values for the three known flags.
    if (typeof patch.strictMode === 'boolean') next.strictMode = patch.strictMode;
    if (typeof patch.abacEnabled === 'boolean') next.abacEnabled = patch.abacEnabled;
    if (typeof patch.auditEnabled === 'boolean') next.auditEnabled = patch.auditEnabled;

    const row = await this.prisma.systemSetting.upsert({
      where: { key: SETTING_KEY },
      create: {
        key: SETTING_KEY,
        value: next as object,
        category: 'authz',
        updatedByAdminId: adminId,
      },
      update: { value: next as object, updatedByAdminId: adminId },
    });
    this.override = next;
    this.updatedAt = row.updatedAt;
    this.updatedByAdminId = row.updatedByAdminId ?? null;
    return next;
  }

  /** Full mode info for the readiness dashboard — env vs override vs effective. */
  getModeInfo() {
    const envStrict = this.env.getBoolean('PERMISSIONS_GUARD_STRICT', false);
    const envAbac = this.env.getBoolean('ABAC_ENABLED', false);
    const envAudit = this.env.getBoolean('AUTHZ_AUDIT_ENABLED', true);
    const hasOverride =
      this.override.strictMode !== undefined ||
      this.override.abacEnabled !== undefined ||
      this.override.auditEnabled !== undefined;
    return {
      strictMode: { env: envStrict, override: this.override.strictMode ?? null, effective: this.isStrict() },
      abacEnabled: { env: envAbac, override: this.override.abacEnabled ?? null, effective: this.isAbacEnabled() },
      auditEnabled: { env: envAudit, override: this.override.auditEnabled ?? null, effective: this.isAuditEnabled() },
      source: hasOverride ? 'env+db' : 'env',
      updatedAt: this.updatedAt,
      updatedByAdminId: this.updatedByAdminId,
    };
  }
}
