// Phase 25/26 GST — CustomerTaxProfileService.
//
// Customer-facing CRUD for the customer_tax_profiles table. A customer
// can register up to MAX_PROFILES_PER_CUSTOMER GSTIN-holding entities
// and switch which one is the default for tax-invoice generation.
//
// Consumed by TaxDocumentService at invoice generation (the default — or
// the checkout-selected — profile drives B2B vs B2C + the buyer snapshot).
//
// Phase 161 (Customer Tax Profile flow audit) hardening:
//   B1  AuditPublicFacade row on every CRUD mutation (PII + tax-compliance).
//   #4  fire-and-forget GSTN auto-verify after create (no longer admin-only).
//   #8  append-only CustomerTaxProfileHistory row per mutation.
//   #11 publish tax.customer-profile.* lifecycle events.
//   #12 update({isDefault:false}) now throws instead of silently no-op'ing.
//   #17 a concurrent duplicate create races the @@unique → mapped to 409.
//   #9  listSharedGstins() — admin fraud-signal report (GSTIN on N accounts).
// (#5 legalNameMismatch + #15 fuzzy match were delivered with the Seller
//  GSTIN Verification audit — the customer flow shares that service.)

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { type CustomerTaxProfile, Prisma } from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';
import {
  BadRequestAppException,
  ConflictAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';
import { validateGstin } from '../../domain/gstin-validator';
import { normalizeStateName } from '../../domain/state-code-map';
import type { BillingAddressDto } from '../../presentation/dtos/billing-address.dto';
import { GstnVerificationService } from './gstn-verification.service';

const MAX_PROFILES_PER_CUSTOMER = 5;
// Phase 200 (audit #1) — cache the india_states code→name index so the per-CRUD
// state cross-validation is not a DB round-trip on the hot path.
const STATE_INDEX_TTL_MS = 5 * 60_000;

/**
 * Phase 200 (audit #12) — strip angle brackets + ASCII/Unicode control
 * characters from customer-supplied free text that is later rendered verbatim
 * into invoice PDFs and notification emails (legalName, billing address lines).
 * Defence-in-depth beyond the DTO transform — a direct service caller is
 * covered too. Whitespace is collapsed; the result is trimmed.
 */
// C0 (0x00-0x1F) + DEL (0x7F) + C1 (0x80-0x9F) control characters. Built via
// RegExp() with explicit code points so no raw control bytes live in source.
const CONTROL_CHARS_RE = new RegExp('[\\u0000-\\u001F\\u007F-\\u009F]', 'g');

export function sanitizeTaxText(input: string): string {
  return input
    .replace(CONTROL_CHARS_RE, ' ')
    .replace(/[<>]/g, ' ') // neutralise tag-injection into PDF/HTML/email
    .replace(/\s+/g, ' ')
    .trim();
}

/** Sanitize every string field of a billing address (#12). */
function sanitizeBillingAddress(addr: BillingAddressDto): BillingAddressDto {
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(addr)) {
    clean[k] = typeof v === 'string' ? sanitizeTaxText(v) : v;
  }
  return clean as unknown as BillingAddressDto;
}

export const CUSTOMER_TAX_PROFILE_EVENTS = {
  CREATED: 'tax.customer-profile.created',
  UPDATED: 'tax.customer-profile.updated',
  DELETED: 'tax.customer-profile.deleted',
  DEFAULT_CHANGED: 'tax.customer-profile.default_changed',
} as const;

export interface CreateInput {
  gstin: string;
  legalName: string;
  billingAddress: BillingAddressDto;
  isDefault?: boolean;
}

export interface UpdateInput {
  legalName?: string;
  billingAddress?: BillingAddressDto;
  isDefault?: boolean;
}

interface MutationCtx {
  ipAddress?: string | null;
}

// Phase 200 (audit #13) — explicit customer-SAFE projection. Internal-only
// columns (verifiedBy / verificationNotes / verificationFailureReason /
// gstnRawResponseJson / lastVerifiedProvider) are NEVER selected, so they
// cannot leak to a customer even if a future controller serialiser regresses.
// legalNameMismatch + gstnPortalStatus ARE included (#4/#8) so the UI can warn.
export const CUSTOMER_SAFE_SELECT = {
  id: true,
  gstin: true,
  legalName: true,
  billingAddressJson: true,
  stateCode: true,
  isDefault: true,
  isVerified: true,
  verifiedAt: true,
  legalNameMismatch: true,
  gstnPortalStatus: true,
  createdAt: true,
  updatedAt: true,
} as const;

export type CustomerSafeTaxProfile = Prisma.CustomerTaxProfileGetPayload<{
  select: typeof CUSTOMER_SAFE_SELECT;
}>;

/** #6 — can this profile back a B2B tax invoice right now? */
export interface TaxProfileUsability {
  ownedByCustomer: boolean;
  usable: boolean;
  reason:
    | 'OK'
    | 'NOT_OWNED'
    | 'UNVERIFIED'
    | 'LEGAL_NAME_MISMATCH'
    | 'PORTAL_INACTIVE';
  isVerified: boolean;
  legalNameMismatch: boolean;
  portalStatus: string | null;
}

@Injectable()
export class CustomerTaxProfileService {
  private readonly logger = new Logger(CustomerTaxProfileService.name);
  // Phase 200 (audit #1) — cached india_states code→name index for state X-val.
  private stateCodeToName: ReadonlyMap<string, string> | null = null;
  private stateIndexExpiresAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditPublicFacade,
    @Optional() private readonly eventBus?: EventBusService,
    // @Optional so unit tests / partial-DI environments construct without it.
    @Optional()
    @Inject(GstnVerificationService)
    private readonly gstnVerification?: GstnVerificationService,
  ) {}

  async list(customerId: string): Promise<CustomerSafeTaxProfile[]> {
    // #13 — customer-safe projection at the repo boundary (no internal cols).
    return this.prisma.customerTaxProfile.findMany({
      where: { customerId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
      select: CUSTOMER_SAFE_SELECT,
    });
  }

  async findOne(customerId: string, id: string): Promise<CustomerTaxProfile> {
    const profile = await this.prisma.customerTaxProfile.findUnique({
      where: { id },
    });
    if (!profile || profile.customerId !== customerId) {
      throw new NotFoundAppException('Tax profile not found');
    }
    return profile;
  }

  /**
   * Phase 200 (audit #6) — usability check for the checkout place-order gate.
   * Ownership ALONE is not enough: an unverified / name-mismatched / portal-
   * SUSPENDED-or-CANCELLED GSTIN must not silently mint a B2B invoice that the
   * buyer can't reconcile (GSTR-2A / ITC break). Returns the ownership result
   * PLUS a usable flag + machine reason so the facade/checkout can decide
   * whether to allow, warn, or block (STRICT) without reaching into our schema.
   *
   * Non-throwing: a missing/foreign profile returns ownedByCustomer:false
   * rather than raising, so the facade stays a thin boolean-ish adapter.
   */
  async getUsability(customerId: string, id: string): Promise<TaxProfileUsability> {
    const profile = await this.prisma.customerTaxProfile.findUnique({
      where: { id },
      select: {
        customerId: true,
        isVerified: true,
        legalNameMismatch: true,
        gstnPortalStatus: true,
      },
    });
    if (!profile || profile.customerId !== customerId) {
      return {
        ownedByCustomer: false,
        usable: false,
        reason: 'NOT_OWNED',
        isVerified: false,
        legalNameMismatch: false,
        portalStatus: null,
      };
    }
    const portalStatus = profile.gstnPortalStatus ?? null;
    const portalInactive =
      portalStatus === 'SUSPENDED' ||
      portalStatus === 'CANCELLED' ||
      portalStatus === 'INACTIVE';
    let reason: TaxProfileUsability['reason'] = 'OK';
    if (!profile.isVerified) reason = 'UNVERIFIED';
    else if (profile.legalNameMismatch) reason = 'LEGAL_NAME_MISMATCH';
    else if (portalInactive) reason = 'PORTAL_INACTIVE';
    return {
      ownedByCustomer: true,
      usable: reason === 'OK',
      reason,
      isVerified: profile.isVerified,
      legalNameMismatch: profile.legalNameMismatch,
      portalStatus,
    };
  }

  async create(
    customerId: string,
    input: CreateInput,
    ctx: MutationCtx = {},
  ): Promise<CustomerTaxProfile> {
    const validation = validateGstin(input.gstin);
    if (!validation.isValid || !validation.normalized || !validation.stateCode) {
      throw new BadRequestAppException(
        `Invalid GSTIN: ${validation.errors.join('; ') || 'failed format / checksum check'}`,
      );
    }
    const gstin = validation.normalized;
    const stateCode = validation.stateCode;
    this.assertAddressShape(input.billingAddress);
    // #12 — strip control/angle-bracket chars from PDF/email-rendered text.
    const cleanLegalName = sanitizeTaxText(input.legalName);
    const cleanAddress = sanitizeBillingAddress(input.billingAddress);
    if (!cleanLegalName) {
      throw new BadRequestAppException('legalName must contain printable characters.');
    }
    // #1 — the billing-address state (free text) must agree with the state the
    // GSTIN encodes in positions 1-2. A mismatch silently corrupts the
    // CGST/SGST↔IGST split at invoice time, so reject it at the boundary.
    await this.assertBillingStateMatchesGstin(cleanAddress, stateCode, gstin);

    const existingCount = await this.prisma.customerTaxProfile.count({
      where: { customerId },
    });
    if (existingCount >= MAX_PROFILES_PER_CUSTOMER) {
      throw new BadRequestAppException(
        `Maximum of ${MAX_PROFILES_PER_CUSTOMER} tax profiles per account. Delete one before adding another.`,
      );
    }

    const duplicate = await this.prisma.customerTaxProfile.findFirst({
      where: { customerId, gstin },
      select: { id: true },
    });
    if (duplicate) {
      throw new ConflictAppException(`This GSTIN is already saved on your account.`);
    }

    const shouldBeDefault = input.isDefault === true || existingCount === 0;

    let created: CustomerTaxProfile;
    try {
      created = await this.prisma.$transaction(async (tx) => {
        if (shouldBeDefault) {
          await tx.customerTaxProfile.updateMany({
            where: { customerId, isDefault: true },
            data: { isDefault: false },
          });
        }
        const row = await tx.customerTaxProfile.create({
          data: {
            customerId,
            gstin,
            stateCode,
            legalName: cleanLegalName,
            billingAddressJson: cleanAddress as unknown as Prisma.InputJsonValue,
            isDefault: shouldBeDefault,
            isVerified: false,
          },
        });
        await tx.customerTaxProfileHistory.create({
          data: {
            profileId: row.id,
            customerId,
            action: 'CREATE',
            oldValues: Prisma.JsonNull,
            newValues: snapshot(row) as Prisma.InputJsonValue,
            changedBy: customerId,
          },
        });
        return row;
      });
    } catch (err) {
      // #17 — concurrent duplicate races the @@unique([customerId, gstin]).
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictAppException('This GSTIN is already saved on your account.');
      }
      throw err;
    }

    await this.writeAudit(customerId, CUSTOMER_TAX_PROFILE_EVENTS.CREATED, created.id, {
      before: null,
      after: snapshot(created),
      ipAddress: ctx.ipAddress,
    });
    this.emit(CUSTOMER_TAX_PROFILE_EVENTS.CREATED, created.id, customerId, { gstin });
    this.logger.log(
      `Tax profile created for customer ${customerId}: ${gstin} (default=${shouldBeDefault})`,
    );

    // #4 — kick off GSTN verification (fire-and-forget; non-throwing).
    if (this.gstnVerification) {
      void this.gstnVerification
        .verifyCustomerTaxProfile({
          profileId: created.id,
          actorId: 'system-auto-verify',
          ipAddress: ctx.ipAddress,
        })
        .catch((e) =>
          this.logger.warn(
            `Auto-verify failed for profile ${created.id}: ${(e as Error).message}`,
          ),
        );
    }

    return created;
  }

  async update(
    customerId: string,
    id: string,
    input: UpdateInput,
    ctx: MutationCtx = {},
  ): Promise<CustomerTaxProfile> {
    const existing = await this.findOne(customerId, id);

    // #12 — there is no "clear the default" operation; every customer with
    // profiles has exactly one default. Reject instead of silently no-op'ing
    // so an API consumer gets a clear signal.
    if (input.isDefault === false) {
      throw new BadRequestAppException(
        'Cannot clear the default flag directly. Set a different profile as default instead.',
      );
    }

    const data: Prisma.CustomerTaxProfileUpdateInput = {};
    let cleanLegalName: string | undefined;
    if (input.legalName !== undefined) {
      cleanLegalName = sanitizeTaxText(input.legalName); // #12
      if (!cleanLegalName) {
        throw new BadRequestAppException('legalName must contain printable characters.');
      }
      data.legalName = cleanLegalName;
    }
    let cleanAddress: BillingAddressDto | undefined;
    if (input.billingAddress !== undefined) {
      this.assertAddressShape(input.billingAddress);
      cleanAddress = sanitizeBillingAddress(input.billingAddress); // #12
      // #1 — GSTIN is immutable on update, so cross-check the new address state
      // against the profile's existing (GSTIN-derived) stateCode.
      await this.assertBillingStateMatchesGstin(cleanAddress, existing.stateCode, existing.gstin);
      data.billingAddressJson = cleanAddress as unknown as Prisma.InputJsonValue;
    }

    // #5 — editing the verified identity (legal name or billing-address state)
    // invalidates the prior GSTN verification: the row no longer matches what
    // the portal confirmed. Reset to unverified and re-trigger verification so
    // a STRICT-mode B2B invoice can't be issued against a now-stale check.
    const legalNameChanged =
      cleanLegalName !== undefined && cleanLegalName !== existing.legalName;
    const billingStateChanged =
      cleanAddress !== undefined &&
      normalizeStateName(cleanAddress.state) !==
        normalizeStateName(billingStateOf(existing.billingAddressJson));
    const verificationInvalidated =
      existing.isVerified && (legalNameChanged || billingStateChanged);
    if (verificationInvalidated) {
      data.isVerified = false;
      data.verifiedAt = null;
      data.verifiedBy = null;
      data.verificationNotes = this.appendNote(
        existing.verificationNotes,
        `[${new Date().toISOString()}] verification reset — ${
          legalNameChanged ? 'legalName' : 'billingAddress.state'
        } edited by customer; re-verification queued`,
      );
    }

    const promoteToDefault = input.isDefault === true && !existing.isDefault;
    if (!promoteToDefault && Object.keys(data).length === 0) {
      return existing; // genuine no-op (e.g. isDefault:true on already-default)
    }

    const action = promoteToDefault ? 'SET_DEFAULT' : 'UPDATE';
    const updated = await this.prisma.$transaction(async (tx) => {
      if (promoteToDefault) {
        await tx.customerTaxProfile.updateMany({
          where: { customerId, isDefault: true },
          data: { isDefault: false },
        });
        data.isDefault = true;
      }
      const row = await tx.customerTaxProfile.update({ where: { id }, data });
      await tx.customerTaxProfileHistory.create({
        data: {
          profileId: id,
          customerId,
          action,
          oldValues: snapshot(existing) as Prisma.InputJsonValue,
          newValues: snapshot(row) as Prisma.InputJsonValue,
          changedBy: customerId,
        },
      });
      return row;
    });

    const event = promoteToDefault
      ? CUSTOMER_TAX_PROFILE_EVENTS.DEFAULT_CHANGED
      : CUSTOMER_TAX_PROFILE_EVENTS.UPDATED;
    await this.writeAudit(customerId, event, id, {
      before: snapshot(existing),
      after: snapshot(updated),
      ipAddress: ctx.ipAddress,
    });
    this.emit(event, id, customerId, { gstin: updated.gstin, action, verificationInvalidated });

    // #5 — re-run GSTN verification when an edit invalidated the prior check.
    if (verificationInvalidated && this.gstnVerification) {
      void this.gstnVerification
        .verifyCustomerTaxProfile({
          profileId: id,
          actorId: 'system-reverify-on-edit',
          force: true,
          ipAddress: ctx.ipAddress,
        })
        .catch((e) =>
          this.logger.warn(
            `Re-verify after edit failed for profile ${id}: ${(e as Error).message}`,
          ),
        );
    }
    return updated;
  }

  async delete(customerId: string, id: string, ctx: MutationCtx = {}): Promise<void> {
    const existing = await this.findOne(customerId, id);
    if (existing.isDefault) {
      const otherCount = await this.prisma.customerTaxProfile.count({
        where: { customerId, NOT: { id } },
      });
      if (otherCount > 0) {
        throw new BadRequestAppException(
          'Cannot delete the default tax profile while other profiles exist. ' +
            'Set a different profile as default first, then delete this one.',
        );
      }
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.customerTaxProfile.delete({ where: { id } });
      // History survives the hard delete (no FK to the row).
      await tx.customerTaxProfileHistory.create({
        data: {
          profileId: id,
          customerId,
          action: 'DELETE',
          oldValues: snapshot(existing) as Prisma.InputJsonValue,
          newValues: Prisma.JsonNull,
          changedBy: customerId,
        },
      });
    });
    await this.writeAudit(customerId, CUSTOMER_TAX_PROFILE_EVENTS.DELETED, id, {
      before: snapshot(existing),
      after: null,
      ipAddress: ctx.ipAddress,
    });
    this.emit(CUSTOMER_TAX_PROFILE_EVENTS.DELETED, id, customerId, { gstin: existing.gstin });
    this.logger.log(`Tax profile ${id} deleted for customer ${customerId}`);
  }

  async setDefault(
    customerId: string,
    id: string,
    ctx: MutationCtx = {},
  ): Promise<CustomerTaxProfile> {
    const existing = await this.findOne(customerId, id);
    if (existing.isDefault) return existing;
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.customerTaxProfile.updateMany({
        where: { customerId, isDefault: true },
        data: { isDefault: false },
      });
      const row = await tx.customerTaxProfile.update({
        where: { id },
        data: { isDefault: true },
      });
      await tx.customerTaxProfileHistory.create({
        data: {
          profileId: id,
          customerId,
          action: 'SET_DEFAULT',
          oldValues: snapshot(existing) as Prisma.InputJsonValue,
          newValues: snapshot(row) as Prisma.InputJsonValue,
          changedBy: customerId,
        },
      });
      return row;
    });
    await this.writeAudit(customerId, CUSTOMER_TAX_PROFILE_EVENTS.DEFAULT_CHANGED, id, {
      before: snapshot(existing),
      after: snapshot(updated),
      ipAddress: ctx.ipAddress,
    });
    this.emit(CUSTOMER_TAX_PROFILE_EVENTS.DEFAULT_CHANGED, id, customerId, { gstin: updated.gstin });
    return updated;
  }

  /**
   * Phase 161 (audit #9) — admin fraud-signal report: GSTINs saved on more
   * than `threshold` distinct customer accounts (possible account-takeover /
   * GSTIN-abuse pattern). Read-only aggregate.
   */
  async listSharedGstins(
    threshold = 2,
  ): Promise<Array<{ gstin: string; customerCount: number }>> {
    const rows = await this.prisma.customerTaxProfile.groupBy({
      by: ['gstin'],
      _count: { customerId: true },
      having: { customerId: { _count: { gt: Math.max(1, threshold - 1) } } },
      orderBy: { _count: { customerId: 'desc' } },
      take: 200,
    });
    return rows.map((r) => ({ gstin: r.gstin, customerCount: r._count.customerId }));
  }

  // ── helpers ────────────────────────────────────────────────────────

  private assertAddressShape(addr: unknown): void {
    // #7 — defence in depth beyond the DTO (guards direct service callers).
    if (addr === null || typeof addr !== 'object' || Array.isArray(addr)) {
      throw new BadRequestAppException('billingAddress must be a structured object.');
    }
  }

  /**
   * Phase 200 (audit #1) — reject a billing-address state that doesn't belong to
   * the GSTIN's state code. The CGST/SGST vs IGST decision keys off the supplier
   * vs place-of-supply state; if the saved billing state disagrees with the
   * GSTIN's embedded state, a B2B invoice splits tax the wrong way (and the
   * buyer's ITC reconciliation breaks). We resolve the GSTIN's stateCode to its
   * canonical india_states name and require the (normalised) billing state to
   * equal it. Unknown india_states code (e.g. 97/99 special regions absent from
   * the master) → skip the check rather than block a legitimate GSTIN.
   */
  private async assertBillingStateMatchesGstin(
    address: BillingAddressDto,
    gstinStateCode: string,
    gstin: string,
  ): Promise<void> {
    const billingState = normalizeStateName(address.state);
    if (!billingState) {
      throw new BadRequestAppException('billingAddress.state is required.');
    }
    const index = await this.getCodeToNameIndex();
    const expectedName = index.get(gstinStateCode);
    if (!expectedName) {
      // Code not in the master (special region) — can't cross-validate; allow.
      this.logger.warn(
        `GSTIN ${gstin} state code ${gstinStateCode} not in india_states master; skipping state cross-validation`,
      );
      return;
    }
    if (normalizeStateName(expectedName) !== billingState) {
      throw new BadRequestAppException(
        `billingAddress.state ("${address.state}") does not match the state encoded in the GSTIN ` +
          `(code ${gstinStateCode} = "${expectedName}"). A B2B invoice keys CGST/SGST vs IGST off this ` +
          `state, so it must match the GSTIN. Correct the billing state or use the GSTIN for the right state.`,
      );
    }
  }

  /**
   * india_states code→name index, cached (#1). Read-mostly master; a 5-minute
   * TTL keeps the per-CRUD validation off the DB hot path while still picking up
   * an admin edit reasonably quickly.
   */
  private async getCodeToNameIndex(): Promise<ReadonlyMap<string, string>> {
    if (this.stateCodeToName && this.stateIndexExpiresAt > Date.now()) {
      return this.stateCodeToName;
    }
    const rows = await this.prisma.indiaState.findMany({
      where: { isActive: true },
      select: { gstStateCode: true, stateName: true },
    });
    const m = new Map<string, string>();
    for (const r of rows) m.set(r.gstStateCode, r.stateName);
    this.stateCodeToName = m;
    this.stateIndexExpiresAt = Date.now() + STATE_INDEX_TTL_MS;
    return m;
  }

  /** Append one bounded note line (mirrors GstnVerificationService.appendNotes). */
  private appendNote(existing: string | null, latest: string): string {
    if (!existing) return latest;
    const lines = `${existing}\n${latest}`.split('\n');
    return lines.slice(-50).join('\n');
  }

  private async writeAudit(
    customerId: string,
    action: string,
    profileId: string,
    payload: { before: unknown; after: unknown; ipAddress?: string | null },
  ): Promise<void> {
    await this.audit
      .writeAuditLog({
        actorId: customerId,
        actorRole: 'CUSTOMER',
        action,
        module: 'tax',
        resource: 'customer_tax_profile',
        resourceId: profileId,
        oldValue: payload.before ?? undefined,
        newValue: payload.after ?? undefined,
        metadata: payload.ipAddress ? { ipAddress: payload.ipAddress } : undefined,
      })
      .catch((err) =>
        this.logger.error(
          `Customer-tax-profile audit-log write failed for ${profileId}: ${(err as Error).message}`,
        ),
      );
  }

  private emit(
    eventName: string,
    profileId: string,
    customerId: string,
    payload: Record<string, unknown>,
  ): void {
    if (!this.eventBus) return;
    void this.eventBus
      .publish({
        eventName,
        aggregate: 'CustomerTaxProfile',
        aggregateId: profileId,
        occurredAt: new Date(),
        payload: { profileId, customerId, ...payload },
      })
      .catch(() => undefined);
  }
}

/**
 * Phase 200 (audit #5) — pull the `state` field out of a persisted
 * billingAddressJson blob (shape is the BillingAddressDto). Returns '' when the
 * blob is missing/!object so the change-detection treats it as "unknown".
 */
function billingStateOf(billingAddressJson: unknown): string {
  if (billingAddressJson && typeof billingAddressJson === 'object') {
    const s = (billingAddressJson as Record<string, unknown>).state;
    if (typeof s === 'string') return s;
  }
  return '';
}

function snapshot(row: {
  gstin: string;
  legalName: string;
  billingAddressJson: unknown;
  stateCode: string;
  isDefault: boolean;
  isVerified: boolean;
}): Record<string, unknown> {
  return {
    gstin: row.gstin,
    legalName: row.legalName,
    billingAddressJson: row.billingAddressJson,
    stateCode: row.stateCode,
    isDefault: row.isDefault,
    isVerified: row.isVerified,
  };
}
