// Phase 2 — PlaceOfSupplyService.
//
// DB-aware wrapper around the pure resolvePlaceOfSupply function.
// Loads supplier state (seller / franchise / platform) and customer
// state (from shipping address snapshot) for a given sub-order, and
// returns the place-of-supply decision plus the CGST/SGST vs IGST
// split.
//
// Hot-path safe: india_states master is cached in-memory (60s TTL,
// busted via TaxConfigService.invalidate).
//
// See docs/tax/CA.md §3.1 + docs/tax/GST_ASSUMPTIONS.md §3.

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import {
  resolvePlaceOfSupply,
  PlaceOfSupplyResolutionError,
  type PlaceOfSupplyResult,
  type B2bPosSource,
} from '../../domain/place-of-supply';
import {
  buildCodeToNameIndex,
  buildStateIndex,
  extractStateCodeFromAddress,
} from '../../domain/state-code-map';
import { TaxConfigService } from './tax-config.service';

const STATE_INDEX_CACHE_TTL_MS = 60_000;

@Injectable()
export class PlaceOfSupplyService {
  private readonly logger = new Logger(PlaceOfSupplyService.name);
  private stateIndex: Map<string, string> | null = null;
  // Phase 159z (GSTR-8 audit #4) — inverse index (code → name) kept in
  // sync with stateIndex via the same TTL. Lazily filled by getStateIndex().
  private codeToNameIndex: Map<string, string> | null = null;
  private stateIndexExpiresAt = 0;
  private platformDefaultStateCode: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly taxConfig: TaxConfigService,
  ) {}

  /**
   * Resolve place-of-supply for every sub-order in a master order.
   * Returns a map of subOrderId → resolution result.
   *
   * Test-mode behaviour (TAX_STRICT_MODE=false):
   *   - If a state code cannot be resolved, falls back to
   *     `isIntraState: false` (IGST) with a warning logged and the
   *     resolutionReason set to "FALLBACK_INTER_STATE_..."
   * Strict-mode behaviour (TAX_STRICT_MODE=true):
   *   - Throws PlaceOfSupplyResolutionError. Callers must surface a
   *     friendly error to the customer.
   */
  async resolveForMasterOrder(masterOrderId: string): Promise<Map<string, PlaceOfSupplyResult>> {
    const order = await this.prisma.masterOrder.findUnique({
      where: { id: masterOrderId },
      select: {
        id: true,
        shippingAddressSnapshot: true,
        subOrders: {
          select: {
            id: true,
            sellerId: true,
            // Phase 1 added gstStateCode on Seller; pick it from there.
            seller: {
              select: { id: true, gstStateCode: true, state: true, gstin: true, gstRegistrationType: true },
            },
            franchiseId: true,
            franchise: {
              select: { id: true, state: true, gstNumber: true },
            },
            fulfillmentNodeType: true,
          },
        },
      },
    });

    if (!order) {
      throw new Error(`MasterOrder ${masterOrderId} not found`);
    }

    const stateIndex = await this.getStateIndex();
    const strictMode = await this.taxConfig.getBoolean('tax_strict_mode', false);
    const b2bSource = await this.taxConfig.getString('b2b_place_of_supply_source', 'SHIPPING');

    // Customer shipping state — extract once
    const { stateCode: customerStateCode, source: customerStateSource } = extractStateCodeFromAddress(
      order.shippingAddressSnapshot,
      stateIndex,
    );

    if (!customerStateCode) {
      this.logger.warn(
        `MasterOrder ${masterOrderId}: cannot resolve customer state from shippingAddressSnapshot`,
        'PlaceOfSupplyService',
      );
    }

    const result = new Map<string, PlaceOfSupplyResult>();

    for (const sub of order.subOrders) {
      // Determine supplier state: seller GST state > seller free-text > franchise state > platform default
      let supplierStateCode: string | null = null;
      let supplierStateSource = '';

      if (sub.seller?.gstStateCode) {
        supplierStateCode = sub.seller.gstStateCode;
        supplierStateSource = 'seller.gstStateCode';
      } else if (sub.seller?.state) {
        const fromName = stateIndex.get(normaliseInline(sub.seller.state));
        if (fromName) {
          supplierStateCode = fromName;
          supplierStateSource = 'seller.state (legacy name lookup)';
        }
      }

      if (!supplierStateCode && sub.franchise?.state) {
        const fromName = stateIndex.get(normaliseInline(sub.franchise.state));
        if (fromName) {
          supplierStateCode = fromName;
          supplierStateSource = 'franchise.state';
        }
      }

      if (!supplierStateCode) {
        supplierStateCode = await this.getPlatformDefaultStateCode();
        supplierStateSource = 'platform_gst_profiles.default';
      }

      // Attempt resolution; fall back in test mode
      try {
        const resolved = resolvePlaceOfSupply({
          supplierStateCode,
          customerShippingStateCode: customerStateCode ?? supplierStateCode, // intra fallback if customer state unknown
          invoiceType: 'B2C',
          posSourceForB2b: b2bSource as B2bPosSource,
        });
        result.set(sub.id, {
          ...resolved,
          resolutionReason: `${resolved.resolutionReason} | supplier=${supplierStateSource} | customer=${customerStateSource ?? 'unresolved'}`,
        });
      } catch (err) {
        if (strictMode) {
          throw err;
        }
        if (err instanceof PlaceOfSupplyResolutionError) {
          this.logger.warn(
            `Sub-order ${sub.id} POS resolution failed: ${err.message}; defaulting to IGST (test mode)`,
            'PlaceOfSupplyService',
          );
        } else {
          throw err;
        }
        result.set(sub.id, {
          supplierStateCode: supplierStateCode ?? '00',
          placeOfSupplyStateCode: customerStateCode ?? '00',
          isIntraState: false,
          taxSplitType: 'IGST',
          resolutionReason: `FALLBACK_INTER_STATE_TEST_MODE: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }

    return result;
  }

  /** Pure-function-friendly variant used by services that already have state codes. */
  resolveSingle(input: Parameters<typeof resolvePlaceOfSupply>[0]): PlaceOfSupplyResult {
    return resolvePlaceOfSupply(input);
  }

  private async getStateIndex(): Promise<Map<string, string>> {
    if (this.stateIndex && this.stateIndexExpiresAt > Date.now()) {
      return this.stateIndex;
    }
    const rows = await this.prisma.indiaState.findMany({
      where: { isActive: true },
      select: { gstStateCode: true, stateName: true },
    });
    this.stateIndex = buildStateIndex(rows);
    this.codeToNameIndex = buildCodeToNameIndex(rows);
    this.stateIndexExpiresAt = Date.now() + STATE_INDEX_CACHE_TTL_MS;
    return this.stateIndex;
  }

  /**
   * Phase 159z — code→name lookup used by GSTR-8 to resolve
   * place-of-supply state codes into human-readable names for the
   * CBIC-format CSV column. Same 60s TTL cache as the name→code
   * index so both directions stay in sync.
   *
   * Returns a Map keyed by 2-digit GST state code; values are the
   * canonical state name (e.g. '27' → 'Maharashtra'). Unknown codes
   * (e.g. '99' Other Territory) fall back to the code itself at the
   * call site.
   */
  async getStateCodeToNameMap(): Promise<ReadonlyMap<string, string>> {
    if (
      this.codeToNameIndex &&
      this.stateIndexExpiresAt > Date.now()
    ) {
      return this.codeToNameIndex;
    }
    // Re-load both directions in one round-trip.
    await this.getStateIndex();
    return this.codeToNameIndex ?? new Map<string, string>();
  }

  private async getPlatformDefaultStateCode(): Promise<string> {
    if (this.platformDefaultStateCode) return this.platformDefaultStateCode;
    const profile = await this.prisma.platformGstProfile.findFirst({
      where: { isDefault: true, isActive: true },
      select: { gstStateCode: true },
    });
    this.platformDefaultStateCode = profile?.gstStateCode ?? '36'; // Telangana fallback per seed
    return this.platformDefaultStateCode;
  }

  /** Bust the cached state-name index (admin edited india_states). */
  invalidateStateCache(): void {
    this.stateIndex = null;
    this.stateIndexExpiresAt = 0;
    this.platformDefaultStateCode = null;
  }
}

function normaliseInline(name: string): string {
  return name.trim().toUpperCase().replace(/\s+/g, ' ');
}
