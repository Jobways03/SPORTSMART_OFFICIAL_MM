// Phase B (P0.5) — Funding split.
//
// Given an item's allocated discount and the parent Discount's
// funding configuration, compute who bears how much of the cost.
// One row per `liabilityParty` (PLATFORM / SELLER / BRAND) in the
// `discount_liability_ledger` table. Settlement reads these rows
// to decide whether to deduct from seller payout.
//
// Conservation rule: sum of all party shares must equal the
// allocated discount paise (no money disappears between allocation
// and ledger).

export type FundingType =
  | 'PLATFORM'
  | 'SELLER'
  | 'BRAND'
  | 'FRANCHISE'
  | 'SHARED'
  | 'NONE';
export type LiabilityParty =
  | 'PLATFORM'
  | 'SELLER'
  | 'BRAND'
  | 'FRANCHISE'
  | 'SHARED';

export interface FundingConfig {
  fundingType: FundingType;
  /** 0–100. Used only when fundingType=SHARED. */
  platformFundingPercent?: number;
  sellerFundingPercent?: number;
  brandFundingPercent?: number;
  // Phase 247-FB — franchise share of a SHARED split (or implied 100 for a
  // pure FRANCHISE-funded discount).
  franchiseFundingPercent?: number;
  // Phase 247-FB — attribution ids for the funded party. franchiseId NULL on
  // a FRANCHISE discount → attribute to the fulfilling franchise per item;
  // brandId identifies the co-marketing brand. Not used by the split math
  // (percentages drive that) — carried so the ledger row can attribute.
  franchiseId?: string | null;
  brandId?: string | null;
}

export interface FundingShare {
  liabilityParty: LiabilityParty;
  amountInPaise: bigint;
}

/**
 * Split a single allocation across liability parties.
 *
 * Rules per fundingType:
 *   PLATFORM → 1 row, party=PLATFORM, full amount.
 *   SELLER   → 1 row, party=SELLER, full amount.
 *   BRAND    → 1 row, party=BRAND, full amount.
 *   SHARED   → up to 3 rows, one per non-zero share. Percentages
 *              must sum to 100. Rounding remainder goes to PLATFORM
 *              (deterministic; matches default-decision #1 — the
 *              platform absorbs any odd-paise drift).
 *   NONE     → empty (legacy import / unattributed). Settlement
 *              should treat this as platform-absorbed.
 */
export function splitFundingShares(
  allocationInPaise: bigint,
  config: FundingConfig,
): FundingShare[] {
  if (allocationInPaise < 0n) {
    throw new Error('allocationInPaise cannot be negative');
  }
  if (allocationInPaise === 0n) {
    return [];
  }

  switch (config.fundingType) {
    case 'PLATFORM':
      return [
        { liabilityParty: 'PLATFORM', amountInPaise: allocationInPaise },
      ];
    case 'SELLER':
      return [
        { liabilityParty: 'SELLER', amountInPaise: allocationInPaise },
      ];
    case 'BRAND':
      return [{ liabilityParty: 'BRAND', amountInPaise: allocationInPaise }];
    case 'FRANCHISE':
      return [
        { liabilityParty: 'FRANCHISE', amountInPaise: allocationInPaise },
      ];
    case 'NONE':
      return [];
    case 'SHARED':
      return splitSharedFunding(allocationInPaise, config);
    default:
      throw new Error(`Unknown fundingType: ${config.fundingType}`);
  }
}

function splitSharedFunding(
  allocationInPaise: bigint,
  config: FundingConfig,
): FundingShare[] {
  const platformPct = config.platformFundingPercent ?? 0;
  const sellerPct = config.sellerFundingPercent ?? 0;
  const brandPct = config.brandFundingPercent ?? 0;
  const franchisePct = config.franchiseFundingPercent ?? 0;
  const sum = platformPct + sellerPct + brandPct + franchisePct;

  // Allow 0.01% tolerance for floating-point comparisons (admin
  // form accepts decimals up to 2 places).
  if (Math.abs(sum - 100) > 0.01) {
    throw new Error(
      `SHARED funding percentages must sum to 100 (got ${sum})`,
    );
  }

  const platformBps = BigInt(Math.round(platformPct * 100));
  const sellerBps = BigInt(Math.round(sellerPct * 100));
  const brandBps = BigInt(Math.round(brandPct * 100));
  const franchiseBps = BigInt(Math.round(franchisePct * 100));

  const platformShare = (allocationInPaise * platformBps) / 10_000n;
  const sellerShare = (allocationInPaise * sellerBps) / 10_000n;
  const brandShare = (allocationInPaise * brandBps) / 10_000n;
  const franchiseShare = (allocationInPaise * franchiseBps) / 10_000n;

  // Rounding remainder → PLATFORM (default-decision #1).
  const assigned = platformShare + sellerShare + brandShare + franchiseShare;
  const remainder = allocationInPaise - assigned;

  const shares: FundingShare[] = [];
  if (platformShare + remainder > 0n) {
    shares.push({
      liabilityParty: 'PLATFORM',
      amountInPaise: platformShare + remainder,
    });
  }
  if (sellerShare > 0n) {
    shares.push({ liabilityParty: 'SELLER', amountInPaise: sellerShare });
  }
  if (brandShare > 0n) {
    shares.push({ liabilityParty: 'BRAND', amountInPaise: brandShare });
  }
  if (franchiseShare > 0n) {
    shares.push({
      liabilityParty: 'FRANCHISE',
      amountInPaise: franchiseShare,
    });
  }

  return shares;
}

/**
 * Sanity check: validate that a `FundingConfig` is internally
 * consistent before persisting on a Discount row. Used by the
 * admin discount form's server-side validator.
 */
export function validateFundingConfig(config: FundingConfig): void {
  switch (config.fundingType) {
    case 'PLATFORM':
      if ((config.platformFundingPercent ?? 100) !== 100) {
        throw new Error('PLATFORM funding requires platformFundingPercent=100');
      }
      break;
    case 'SELLER':
      if ((config.sellerFundingPercent ?? 100) !== 100) {
        throw new Error('SELLER funding requires sellerFundingPercent=100');
      }
      break;
    case 'BRAND':
      if ((config.brandFundingPercent ?? 100) !== 100) {
        throw new Error('BRAND funding requires brandFundingPercent=100');
      }
      break;
    case 'FRANCHISE':
      if ((config.franchiseFundingPercent ?? 100) !== 100) {
        throw new Error('FRANCHISE funding requires franchiseFundingPercent=100');
      }
      break;
    case 'SHARED': {
      const sum =
        (config.platformFundingPercent ?? 0) +
        (config.sellerFundingPercent ?? 0) +
        (config.brandFundingPercent ?? 0) +
        (config.franchiseFundingPercent ?? 0);
      if (Math.abs(sum - 100) > 0.01) {
        throw new Error(`SHARED funding percentages must sum to 100 (got ${sum})`);
      }
      break;
    }
    case 'NONE':
      // Legacy / imported. No constraints.
      break;
    default:
      throw new Error(`Unknown fundingType: ${config.fundingType}`);
  }
}
