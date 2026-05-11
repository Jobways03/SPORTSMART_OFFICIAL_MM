import { createHash } from 'node:crypto';

import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type IThinkWarehouseApprovalStatus } from '@prisma/client';

import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { IThinkWarehouseService } from '../../../../integrations/ithink/services/ithink-warehouse.service';

/**
 * Stable hash of the iThink-relevant address fields. Used to detect
 * profile-update drift after a warehouse has been registered with
 * iThink. We normalise (trim, lowercase, collapse whitespace) so
 * cosmetic edits ("ANDHRA PRADESH" → "Andhra Pradesh") don't
 * needlessly trigger a STALE flag.
 *
 * Cannot just compare raw strings because Indian-style address fields
 * frequently get case-swapped or have stray whitespace on every edit
 * even when nothing material has changed.
 */
export function ithinkAddressHash(parts: {
  address: string | null | undefined;
  city: string | null | undefined;
  state: string | null | undefined;
  pincode: string | null | undefined;
  mobile: string | null | undefined;
}): string {
  const normalise = (v: string | null | undefined) =>
    (v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  const payload = [
    normalise(parts.address),
    normalise(parts.city),
    normalise(parts.state),
    normalise(parts.pincode),
    normalise(parts.mobile),
  ].join('|');
  return createHash('sha256').update(payload).digest('hex');
}

/**
 * Normalise the optional pincode-list patch into a Prisma JSON write.
 *
 *   undefined → skip the field (don't change it)
 *   null      → clear the field (Prisma.JsonNull, NOT DbNull because
 *               the column itself stays nullable)
 *   string[]  → write the array
 *
 * Return type is the Prisma JSON-update union so callers spread it
 * directly into `data:` without further narrowing.
 */
function pincodesPatchValue(
  value: string[] | null | undefined,
): Prisma.NullableJsonNullValueInput | Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined;
  if (value === null) return Prisma.JsonNull;
  return value as Prisma.InputJsonValue;
}

/**
 * Four-pass fuzzy match against a name list. Returns the matched
 * entry as it appears in `candidates`, or undefined.
 *   1. exact (case-sensitive) — fastest happy path.
 *   2. lowercase + whitespace-collapsed — handles "ANDHRA PRADESH"
 *      vs "Andhra Pradesh" and "Andhra  Pradesh" (double space).
 *   3. lowercase, ignoring all whitespace and punctuation — handles
 *      "Andhra-Pradesh" / "Andhra Pradesh," / trailing newlines.
 *   4. whole-word contains — handles district-code prefixes like
 *      "SPSR NELLORE" (Indian district name prefixed with the
 *      statutory district code) matching iThink's "Nellore". Word
 *      boundaries prevent obvious false positives. Among multiple
 *      hits the longest candidate wins, so a more specific name is
 *      always preferred.
 *
 * Geography catalogues change rarely; if none of these match the
 * caller raises with a sample of available names so ops can see the
 * exact form iThink expects.
 */
function fuzzyMatch(candidates: string[], target: string): string | undefined {
  const direct = candidates.find((c) => c === target);
  if (direct) return direct;
  const t1 = target.trim().toLowerCase().replace(/\s+/g, ' ');
  const lc = candidates.find((c) => c.trim().toLowerCase().replace(/\s+/g, ' ') === t1);
  if (lc) return lc;
  const t2 = target.toLowerCase().replace(/[^a-z0-9]/g, '');
  const alpha = candidates.find((c) => c.toLowerCase().replace(/[^a-z0-9]/g, '') === t2);
  if (alpha) return alpha;
  // Word-contains pass — target's words must include every word of a
  // candidate (≥3 chars to avoid matching on articles / initials).
  const targetWords = new Set(t1.split(' ').filter((w) => w.length >= 3));
  if (targetWords.size === 0) return undefined;
  const hits = candidates
    .filter((c) => {
      const words = c.trim().toLowerCase().split(/\s+/).filter((w) => w.length >= 3);
      if (words.length === 0) return false;
      return words.every((w) => targetWords.has(w));
    })
    .sort((a, b) => b.length - a.length);
  return hits[0];
}

/**
 * Admin-side delivery-method entitlements. Two responsibilities:
 *
 *   1. Toggle per-seller / per-franchise iThink and self-delivery
 *      enablement flags. These flags gate what method the
 *      seller/franchise can pick when fulfilling a SubOrder.
 *
 *   2. Trigger iThink warehouse registration when iThink is enabled
 *      and no pickup_address_id yet exists. The Add Warehouse call
 *      returns immediately with PENDING; iThink ops approval flips
 *      it to APPROVED within ~24h (mirrored by the daily Get
 *      Warehouse reconciliation cron).
 *
 * The service is intentionally simple — no events, no audit log
 * writes. The admin module's surrounding audit interceptor already
 * captures the controller call.
 */
@Injectable()
export class AdminDeliveryMethodsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ithinkWarehouse: IThinkWarehouseService,
  ) {}

  private async registerIThinkWarehouse(input: {
    companyName: string;
    address1: string;
    mobile: string;
    pincode: string;
    city: string;
    state: string;
  }): Promise<{
    pickupAddressId: string;
    approvalStatus: IThinkWarehouseApprovalStatus;
  }> {
    // Resolve state → state_id → city_id via iThink's geography endpoints.
    // Profile fields are user-entered text (e.g. "ANDHRA PRADESH" vs
    // iThink's "Andhra Pradesh"), so the matcher normalises casing AND
    // whitespace and falls back through three passes before giving up.
    const states = await this.ithinkWarehouse.getStates();
    if (states.length === 0) {
      throw new NotFoundException(
        'iThink Get State returned an empty list. Check sandbox credentials or run geography sync.',
      );
    }
    const matchingState = fuzzyMatch(states.map((s) => s.state_name), input.state);
    if (!matchingState) {
      // Surface a sample so ops can see what iThink does list — much
      // faster to debug than "no match" alone.
      const sample = states.slice(0, 8).map((s) => s.state_name).join(', ');
      throw new NotFoundException(
        `iThink does not list state '${input.state}'. iThink lists e.g. ${sample}. Correct the seller's state to match exactly.`,
      );
    }
    const stateRow = states.find((s) => s.state_name === matchingState)!;

    const cities = await this.ithinkWarehouse.getCities(stateRow.id);
    if (cities.length === 0) {
      throw new NotFoundException(
        `iThink Get City returned no cities for state '${stateRow.state_name}'.`,
      );
    }
    const matchingCity = fuzzyMatch(cities.map((c) => c.city_name), input.city);
    if (!matchingCity) {
      const sample = cities.slice(0, 8).map((c) => c.city_name).join(', ');
      throw new NotFoundException(
        `iThink does not list city '${input.city}' in '${stateRow.state_name}'. iThink lists e.g. ${sample}.`,
      );
    }
    const cityRow = cities.find((c) => c.city_name === matchingCity)!;

    const res = await this.ithinkWarehouse.addWarehouse({
      companyName: input.companyName,
      address1: input.address1,
      mobile: input.mobile,
      pincode: input.pincode,
      cityId: cityRow.id,
      stateId: stateRow.id,
      countryId: '101',
    });
    return {
      pickupAddressId: String(res.warehouse_id),
      // iThink's Add Warehouse always returns pending — ops approves later.
      approvalStatus: 'PENDING',
    };
  }

  /**
   * Read the current entitlement snapshot for a seller, including
   * iThink warehouse approval state. Drift is detected on read so the
   * STALE flag surfaces no matter which write path edited the
   * address — admin edit, seller's own profile update, direct DB
   * seed, even an out-of-band script. If the stored
   * `ithinkRegisteredAddressHash` no longer matches the current
   * profile hash and a warehouse exists, we override `ithinkWarehouseStatus`
   * to STALE in the response without rewriting the database (read-only
   * derivation, safe to compute on every GET).
   */
  async getSellerSettings(sellerId: string) {
    const seller = await this.prisma.seller.findUnique({
      where: { id: sellerId },
      select: {
        id: true,
        sellerName: true,
        sellerShopName: true,
        storeAddress: true,
        city: true,
        state: true,
        sellerZipCode: true,
        sellerContactNumber: true,
        phoneNumber: true,
        ithinkEnabled: true,
        ithinkPickupAddressId: true,
        ithinkWarehouseStatus: true,
        ithinkRegisteredAt: true,
        ithinkRegisteredAddressHash: true,
        selfDeliveryEnabled: true,
        selfDeliveryPincodes: true,
      },
    });
    if (!seller) throw new NotFoundException(`Seller ${sellerId} not found`);

    let effectiveStatus = seller.ithinkWarehouseStatus;
    if (
      seller.ithinkPickupAddressId &&
      seller.ithinkRegisteredAddressHash &&
      effectiveStatus !== 'NOT_REGISTERED'
    ) {
      const currentHash = ithinkAddressHash({
        address: seller.storeAddress,
        city: seller.city,
        state: seller.state,
        pincode: seller.sellerZipCode,
        mobile: seller.sellerContactNumber ?? seller.phoneNumber,
      });
      if (currentHash !== seller.ithinkRegisteredAddressHash) {
        effectiveStatus = 'STALE';
        // Best-effort persist so the next admin who looks doesn't
        // re-compute. If this update fails (DB hiccup), the next read
        // computes the same STALE anyway — idempotent.
        this.prisma.seller
          .update({
            where: { id: sellerId },
            data: { ithinkWarehouseStatus: 'STALE' },
          })
          .catch(() => undefined);
      }
    }

    // Strip `phoneNumber` from the response — it's only there for the
    // hash; the API contract doesn't expose it.
    const { phoneNumber: _phone, ithinkRegisteredAddressHash: _hash, ...rest } = seller;
    return { ...rest, ithinkWarehouseStatus: effectiveStatus };
  }

  async getFranchiseSettings(franchiseId: string) {
    const franchise = await this.prisma.franchisePartner.findUnique({
      where: { id: franchiseId },
      select: {
        id: true,
        businessName: true,
        warehouseAddress: true,
        warehousePincode: true,
        city: true,
        state: true,
        phoneNumber: true,
        ithinkEnabled: true,
        ithinkPickupAddressId: true,
        ithinkWarehouseStatus: true,
        ithinkRegisteredAt: true,
        ithinkRegisteredAddressHash: true,
        selfDeliveryEnabled: true,
        selfDeliveryPincodes: true,
      },
    });
    if (!franchise) throw new NotFoundException(`Franchise ${franchiseId} not found`);

    let effectiveStatus = franchise.ithinkWarehouseStatus;
    if (
      franchise.ithinkPickupAddressId &&
      franchise.ithinkRegisteredAddressHash &&
      effectiveStatus !== 'NOT_REGISTERED'
    ) {
      const currentHash = ithinkAddressHash({
        address: franchise.warehouseAddress,
        city: franchise.city,
        state: franchise.state,
        pincode: franchise.warehousePincode,
        mobile: franchise.phoneNumber,
      });
      if (currentHash !== franchise.ithinkRegisteredAddressHash) {
        effectiveStatus = 'STALE';
        this.prisma.franchisePartner
          .update({
            where: { id: franchiseId },
            data: { ithinkWarehouseStatus: 'STALE' },
          })
          .catch(() => undefined);
      }
    }

    const { ithinkRegisteredAddressHash: _hash, ...rest } = franchise;
    return { ...rest, ithinkWarehouseStatus: effectiveStatus };
  }

  /**
   * Update seller toggles. Toggle changes ONLY flip the flag — they
   * never call iThink. Warehouse registration is a separate explicit
   * action (`registerSellerWithIThink`) so admin can configure the
   * entitlement and retry the carrier-side step independently when
   * iThink is unreachable, rejects credentials, or the seller's
   * profile fields need fixing.
   */
  async updateSellerSettings(
    sellerId: string,
    input: {
      ithinkEnabled?: boolean;
      selfDeliveryEnabled?: boolean;
      selfDeliveryPincodes?: string[] | null;
    },
  ) {
    const seller = await this.prisma.seller.findUnique({
      where: { id: sellerId },
      select: { id: true },
    });
    if (!seller) throw new NotFoundException(`Seller ${sellerId} not found`);

    return this.prisma.seller.update({
      where: { id: sellerId },
      data: {
        ithinkEnabled: input.ithinkEnabled ?? undefined,
        selfDeliveryEnabled: input.selfDeliveryEnabled ?? undefined,
        selfDeliveryPincodes: pincodesPatchValue(input.selfDeliveryPincodes),
      },
      select: {
        id: true,
        sellerName: true,
        sellerShopName: true,
        storeAddress: true,
        city: true,
        state: true,
        sellerZipCode: true,
        sellerContactNumber: true,
        ithinkEnabled: true,
        ithinkPickupAddressId: true,
        ithinkWarehouseStatus: true,
        ithinkRegisteredAt: true,
        selfDeliveryEnabled: true,
        selfDeliveryPincodes: true,
      },
    });
  }

  /**
   * Explicit warehouse-registration action. Calls iThink Add Warehouse
   * using the seller's stored profile address and writes the resulting
   * `pickup_address_id` + `PENDING` approval status back to the seller.
   *
   * Failures here (bad creds, unknown state, etc.) bubble back to the
   * UI as a clear error without rolling back the seller's iThink
   * toggle — the toggle is the entitlement, the registration is the
   * carrier-side reality, and the two should be retryable separately.
   */
  async registerSellerWithIThink(sellerId: string) {
    const seller = await this.prisma.seller.findUnique({
      where: { id: sellerId },
      select: {
        id: true,
        sellerShopName: true,
        sellerName: true,
        storeAddress: true,
        city: true,
        state: true,
        sellerZipCode: true,
        sellerContactNumber: true,
        phoneNumber: true,
        ithinkPickupAddressId: true,
      },
    });
    if (!seller) throw new NotFoundException(`Seller ${sellerId} not found`);
    if (seller.ithinkPickupAddressId) {
      throw new NotFoundException(
        `Seller ${sellerId} is already registered with iThink (pickup_address_id=${seller.ithinkPickupAddressId}).`,
      );
    }
    if (!seller.storeAddress || !seller.city || !seller.state || !seller.sellerZipCode) {
      throw new NotFoundException(
        `Seller ${sellerId} is missing storeAddress / city / state / pincode; complete the profile first.`,
      );
    }

    const registered = await this.registerIThinkWarehouse({
      companyName: seller.sellerShopName,
      address1: seller.storeAddress,
      mobile: seller.sellerContactNumber ?? seller.phoneNumber,
      pincode: seller.sellerZipCode,
      city: seller.city,
      state: seller.state,
    });

    return this.prisma.seller.update({
      where: { id: sellerId },
      data: {
        ithinkPickupAddressId: registered.pickupAddressId,
        ithinkWarehouseStatus: registered.approvalStatus,
        ithinkRegisteredAt: new Date(),
        ithinkRegisteredAddressHash: ithinkAddressHash({
          address: seller.storeAddress,
          city: seller.city,
          state: seller.state,
          pincode: seller.sellerZipCode,
          mobile: seller.sellerContactNumber ?? seller.phoneNumber,
        }),
      },
      select: {
        id: true,
        ithinkPickupAddressId: true,
        ithinkWarehouseStatus: true,
        ithinkRegisteredAt: true,
      },
    });
  }

  /**
   * Re-register a seller's pickup at the current profile address.
   * Unlike the initial registration this is allowed even when an old
   * `ithinkPickupAddressId` exists — it overwrites the pointer with
   * the new warehouse_id. iThink doesn't expose deletion via API, so
   * the old id stays on their side; ops deactivates manually via the
   * iThink web panel.
   *
   * In-flight orders are protected: `SubOrder.pickupAddressIdSnapshot`
   * and `returnAddressIdSnapshot` are captured at book time, so the
   * existing AWB still resolves to the original physical address.
   */
  async reregisterSellerWithIThink(sellerId: string) {
    const seller = await this.prisma.seller.findUnique({
      where: { id: sellerId },
      select: {
        id: true,
        sellerShopName: true,
        storeAddress: true,
        city: true,
        state: true,
        sellerZipCode: true,
        sellerContactNumber: true,
        phoneNumber: true,
        ithinkPickupAddressId: true,
      },
    });
    if (!seller) throw new NotFoundException(`Seller ${sellerId} not found`);
    if (!seller.storeAddress || !seller.city || !seller.state || !seller.sellerZipCode) {
      throw new NotFoundException(
        `Seller ${sellerId} is missing storeAddress / city / state / pincode; complete the profile first.`,
      );
    }

    const previousPickupId = seller.ithinkPickupAddressId;
    const registered = await this.registerIThinkWarehouse({
      companyName: seller.sellerShopName,
      address1: seller.storeAddress,
      mobile: seller.sellerContactNumber ?? seller.phoneNumber,
      pincode: seller.sellerZipCode,
      city: seller.city,
      state: seller.state,
    });

    const updated = await this.prisma.seller.update({
      where: { id: sellerId },
      data: {
        ithinkPickupAddressId: registered.pickupAddressId,
        ithinkWarehouseStatus: registered.approvalStatus,
        ithinkRegisteredAt: new Date(),
        ithinkRegisteredAddressHash: ithinkAddressHash({
          address: seller.storeAddress,
          city: seller.city,
          state: seller.state,
          pincode: seller.sellerZipCode,
          mobile: seller.sellerContactNumber ?? seller.phoneNumber,
        }),
      },
      select: {
        id: true,
        ithinkPickupAddressId: true,
        ithinkWarehouseStatus: true,
        ithinkRegisteredAt: true,
      },
    });
    return { ...updated, previousIThinkPickupAddressId: previousPickupId };
  }

  /** Franchise counterpart — toggles only; carrier registration separate. */
  async updateFranchiseSettings(
    franchiseId: string,
    input: {
      ithinkEnabled?: boolean;
      selfDeliveryEnabled?: boolean;
      selfDeliveryPincodes?: string[] | null;
    },
  ) {
    const franchise = await this.prisma.franchisePartner.findUnique({
      where: { id: franchiseId },
      select: { id: true },
    });
    if (!franchise) throw new NotFoundException(`Franchise ${franchiseId} not found`);

    return this.prisma.franchisePartner.update({
      where: { id: franchiseId },
      data: {
        ithinkEnabled: input.ithinkEnabled ?? undefined,
        selfDeliveryEnabled: input.selfDeliveryEnabled ?? undefined,
        selfDeliveryPincodes: pincodesPatchValue(input.selfDeliveryPincodes),
      },
      select: {
        id: true,
        businessName: true,
        warehouseAddress: true,
        warehousePincode: true,
        city: true,
        state: true,
        phoneNumber: true,
        ithinkEnabled: true,
        ithinkPickupAddressId: true,
        ithinkWarehouseStatus: true,
        ithinkRegisteredAt: true,
        selfDeliveryEnabled: true,
        selfDeliveryPincodes: true,
      },
    });
  }

  /**
   * Pull the latest approval state from iThink (Get Warehouse) for a
   * seller's previously-registered pickup address, and mirror it into
   * `seller.ithinkWarehouseStatus`. Called manually from the admin UI;
   * a daily cron in production would do the same automatically.
   */
  async refreshSellerIThinkStatus(sellerId: string) {
    const seller = await this.prisma.seller.findUnique({
      where: { id: sellerId },
      select: {
        id: true,
        ithinkPickupAddressId: true,
        ithinkRegisteredAddressHash: true,
        storeAddress: true,
        city: true,
        state: true,
        sellerZipCode: true,
        sellerContactNumber: true,
        phoneNumber: true,
      },
    });
    if (!seller) throw new NotFoundException(`Seller ${sellerId} not found`);
    if (!seller.ithinkPickupAddressId) {
      throw new NotFoundException(
        `Seller ${sellerId} has no iThink pickup_address_id yet — register first.`,
      );
    }

    const row = await this.ithinkWarehouse.getWarehouse(seller.ithinkPickupAddressId);
    if (!row) {
      throw new NotFoundException(
        `iThink does not know warehouse_id ${seller.ithinkPickupAddressId}. Re-register the seller.`,
      );
    }
    const iThinkApproval = mapIThinkWarehouseStatus(row.status);

    // Address-drift overlay: even if iThink says the warehouse is
    // APPROVED, the seller may have edited their profile after
    // registration. iThink doesn't know about the new address — it
    // still approves the OLD one we sent. So the effective status
    // must be STALE whenever the current profile hash disagrees with
    // the registered hash, regardless of what iThink reports.
    //
    // Without this overlay, clicking Refresh on a STALE row would wipe
    // the STALE flag back to APPROVED (since iThink's row didn't
    // change), masking the drift.
    const currentHash = ithinkAddressHash({
      address: seller.storeAddress,
      city: seller.city,
      state: seller.state,
      pincode: seller.sellerZipCode,
      mobile: seller.sellerContactNumber ?? seller.phoneNumber,
    });
    const drifted =
      seller.ithinkRegisteredAddressHash != null &&
      currentHash !== seller.ithinkRegisteredAddressHash;
    const effectiveStatus: IThinkWarehouseApprovalStatus = drifted ? 'STALE' : iThinkApproval;

    // Backfill the hash if it's missing — Refresh implies "trust the
    // current state" only when there's no registered hash to compare
    // against. If a hash exists, we never overwrite it here (that's
    // Re-register's job).
    const dataUpdate: Record<string, unknown> = { ithinkWarehouseStatus: effectiveStatus };
    if (!seller.ithinkRegisteredAddressHash) {
      dataUpdate.ithinkRegisteredAddressHash = currentHash;
    }

    return this.prisma.seller.update({
      where: { id: sellerId },
      data: dataUpdate,
      select: {
        id: true,
        ithinkPickupAddressId: true,
        ithinkWarehouseStatus: true,
        ithinkRegisteredAt: true,
      },
    });
  }

  /** Explicit Add Warehouse for a franchise. Same shape as seller. */
  async registerFranchiseWithIThink(franchiseId: string) {
    const franchise = await this.prisma.franchisePartner.findUnique({
      where: { id: franchiseId },
      select: {
        id: true,
        businessName: true,
        warehouseAddress: true,
        warehousePincode: true,
        city: true,
        state: true,
        phoneNumber: true,
        ithinkPickupAddressId: true,
      },
    });
    if (!franchise) throw new NotFoundException(`Franchise ${franchiseId} not found`);
    if (franchise.ithinkPickupAddressId) {
      throw new NotFoundException(
        `Franchise ${franchiseId} is already registered with iThink (pickup_address_id=${franchise.ithinkPickupAddressId}).`,
      );
    }
    if (
      !franchise.warehouseAddress ||
      !franchise.city ||
      !franchise.state ||
      !franchise.warehousePincode
    ) {
      throw new NotFoundException(
        `Franchise ${franchiseId} is missing warehouseAddress / city / state / warehousePincode; complete the profile first.`,
      );
    }

    const registered = await this.registerIThinkWarehouse({
      companyName: franchise.businessName,
      address1: franchise.warehouseAddress,
      mobile: franchise.phoneNumber,
      pincode: franchise.warehousePincode,
      city: franchise.city,
      state: franchise.state,
    });

    return this.prisma.franchisePartner.update({
      where: { id: franchiseId },
      data: {
        ithinkPickupAddressId: registered.pickupAddressId,
        ithinkWarehouseStatus: registered.approvalStatus,
        ithinkRegisteredAt: new Date(),
        ithinkRegisteredAddressHash: ithinkAddressHash({
          address: franchise.warehouseAddress,
          city: franchise.city,
          state: franchise.state,
          pincode: franchise.warehousePincode,
          mobile: franchise.phoneNumber,
        }),
      },
      select: {
        id: true,
        ithinkPickupAddressId: true,
        ithinkWarehouseStatus: true,
        ithinkRegisteredAt: true,
      },
    });
  }

  /** Franchise re-register — same shape as `reregisterSellerWithIThink`. */
  async reregisterFranchiseWithIThink(franchiseId: string) {
    const franchise = await this.prisma.franchisePartner.findUnique({
      where: { id: franchiseId },
      select: {
        id: true,
        businessName: true,
        warehouseAddress: true,
        warehousePincode: true,
        city: true,
        state: true,
        phoneNumber: true,
        ithinkPickupAddressId: true,
      },
    });
    if (!franchise) throw new NotFoundException(`Franchise ${franchiseId} not found`);
    if (
      !franchise.warehouseAddress ||
      !franchise.city ||
      !franchise.state ||
      !franchise.warehousePincode
    ) {
      throw new NotFoundException(
        `Franchise ${franchiseId} is missing warehouseAddress / city / state / warehousePincode; complete the profile first.`,
      );
    }

    const previousPickupId = franchise.ithinkPickupAddressId;
    const registered = await this.registerIThinkWarehouse({
      companyName: franchise.businessName,
      address1: franchise.warehouseAddress,
      mobile: franchise.phoneNumber,
      pincode: franchise.warehousePincode,
      city: franchise.city,
      state: franchise.state,
    });

    const updated = await this.prisma.franchisePartner.update({
      where: { id: franchiseId },
      data: {
        ithinkPickupAddressId: registered.pickupAddressId,
        ithinkWarehouseStatus: registered.approvalStatus,
        ithinkRegisteredAt: new Date(),
        ithinkRegisteredAddressHash: ithinkAddressHash({
          address: franchise.warehouseAddress,
          city: franchise.city,
          state: franchise.state,
          pincode: franchise.warehousePincode,
          mobile: franchise.phoneNumber,
        }),
      },
      select: {
        id: true,
        ithinkPickupAddressId: true,
        ithinkWarehouseStatus: true,
        ithinkRegisteredAt: true,
      },
    });
    return { ...updated, previousIThinkPickupAddressId: previousPickupId };
  }

  /** Franchise mirror of refreshSellerIThinkStatus. */
  async refreshFranchiseIThinkStatus(franchiseId: string) {
    const franchise = await this.prisma.franchisePartner.findUnique({
      where: { id: franchiseId },
      select: {
        id: true,
        ithinkPickupAddressId: true,
        ithinkRegisteredAddressHash: true,
        warehouseAddress: true,
        warehousePincode: true,
        city: true,
        state: true,
        phoneNumber: true,
      },
    });
    if (!franchise) throw new NotFoundException(`Franchise ${franchiseId} not found`);
    if (!franchise.ithinkPickupAddressId) {
      throw new NotFoundException(
        `Franchise ${franchiseId} has no iThink pickup_address_id yet — register first.`,
      );
    }
    const row = await this.ithinkWarehouse.getWarehouse(franchise.ithinkPickupAddressId);
    if (!row) {
      throw new NotFoundException(
        `iThink does not know warehouse_id ${franchise.ithinkPickupAddressId}. Re-register.`,
      );
    }
    const iThinkApproval = mapIThinkWarehouseStatus(row.status);

    // Same drift overlay as the seller-side refresh — iThink's
    // approval is for the address WE sent at registration time, which
    // may not match the franchise's current profile address. STALE
    // wins over APPROVED whenever hashes don't agree.
    const currentHash = ithinkAddressHash({
      address: franchise.warehouseAddress,
      city: franchise.city,
      state: franchise.state,
      pincode: franchise.warehousePincode,
      mobile: franchise.phoneNumber,
    });
    const drifted =
      franchise.ithinkRegisteredAddressHash != null &&
      currentHash !== franchise.ithinkRegisteredAddressHash;
    const effectiveStatus: IThinkWarehouseApprovalStatus = drifted ? 'STALE' : iThinkApproval;

    const dataUpdate: Record<string, unknown> = { ithinkWarehouseStatus: effectiveStatus };
    if (!franchise.ithinkRegisteredAddressHash) {
      dataUpdate.ithinkRegisteredAddressHash = currentHash;
    }

    return this.prisma.franchisePartner.update({
      where: { id: franchiseId },
      data: dataUpdate,
      select: {
        id: true,
        ithinkPickupAddressId: true,
        ithinkWarehouseStatus: true,
        ithinkRegisteredAt: true,
      },
    });
  }
}

/**
 * Translate iThink's warehouse `status` string to our enum. iThink
 * returns title-case strings: "Pending" / "Approved" / "Rejected" /
 * "Active" (synonym for Approved in some endpoints). Normalise
 * case-insensitively so casing drift doesn't keep a warehouse stuck
 * in PENDING after iThink has approved it.
 */
function mapIThinkWarehouseStatus(raw: string | undefined): IThinkWarehouseApprovalStatus {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === 'approved' || v === 'active') return 'APPROVED';
  if (v === 'rejected' || v === 'inactive' || v === 'deactivated') return 'REJECTED';
  if (v === 'pending' || v === 'awaiting' || v === '') return 'PENDING';
  return 'PENDING';
}
