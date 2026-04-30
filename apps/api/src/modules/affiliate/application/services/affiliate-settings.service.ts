import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';

/**
 * Singleton-row store for the affiliate program's tunable knobs
 * (commission default, payout minimum, return / reversal windows,
 * TDS rate + threshold). Read-and-upsert pattern means the GET path
 * never returns null even on a fresh database.
 *
 * Replaces the previous env-driven stub in
 * AdminAffiliateReportsController so admins can edit these from the
 * Settings page without a redeploy. Schema-level defaults match the
 * old hardcoded numbers, so behaviour is unchanged for existing
 * deployments until somebody actually saves a change.
 */
@Injectable()
export class AffiliateSettingsService {
  private static readonly SINGLETON_ID = 'singleton';

  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('AffiliateSettingsService');
  }

  async get(): Promise<SettingsDto> {
    const row = await this.prisma.affiliateSettings.upsert({
      where: { id: AffiliateSettingsService.SINGLETON_ID },
      // Empty `update` => idempotent fetch when the row already exists.
      update: {},
      create: { id: AffiliateSettingsService.SINGLETON_ID },
    });
    return this.toDto(row);
  }

  async update(input: {
    adminId: string;
    patch: Partial<{
      defaultCommissionPercentage: number;
      minimumPayoutAmount: number;
      returnWindowDays: number;
      tdsRate: number;
      tdsThresholdPerFY: number;
      commissionReversalWindowDays: number;
    }>;
  }): Promise<SettingsDto> {
    // Strip undefined keys so we don't overwrite columns the admin
    // didn't touch. (Prisma treats `undefined` as "no change", but
    // being explicit keeps the audit log clean.)
    const data: Record<string, unknown> = { updatedById: input.adminId };
    for (const [k, v] of Object.entries(input.patch)) {
      if (v !== undefined) data[k] = v;
    }

    const row = await this.prisma.affiliateSettings.upsert({
      where: { id: AffiliateSettingsService.SINGLETON_ID },
      update: data,
      create: { id: AffiliateSettingsService.SINGLETON_ID, ...data },
    });

    this.logger.log(
      `Affiliate settings updated by admin ${input.adminId}: ${Object.keys(input.patch).join(', ')}`,
    );
    return this.toDto(row);
  }

  // ── helpers ───────────────────────────────────────────────────

  private toDto(row: {
    defaultCommissionPercentage: { toString(): string } | number;
    minimumPayoutAmount: { toString(): string } | number;
    returnWindowDays: number;
    tdsRate: { toString(): string } | number;
    tdsThresholdPerFY: { toString(): string } | number;
    commissionReversalWindowDays: number;
    updatedAt: Date;
    updatedById: string | null;
  }): SettingsDto {
    return {
      defaultCommissionPercentage: Number(row.defaultCommissionPercentage),
      minimumPayoutAmount: Number(row.minimumPayoutAmount),
      returnWindowDays: row.returnWindowDays,
      tdsRate: Number(row.tdsRate),
      tdsThresholdPerFY: Number(row.tdsThresholdPerFY),
      commissionReversalWindowDays: row.commissionReversalWindowDays,
      updatedAt: row.updatedAt,
      updatedById: row.updatedById,
      editable: true,
    };
  }
}

export interface SettingsDto {
  defaultCommissionPercentage: number;
  minimumPayoutAmount: number;
  returnWindowDays: number;
  tdsRate: number;
  tdsThresholdPerFY: number;
  commissionReversalWindowDays: number;
  updatedAt: Date;
  updatedById: string | null;
  editable: boolean;
}
