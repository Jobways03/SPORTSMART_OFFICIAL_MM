// Shipping options v1 — Shopify-style flat shipping fee with optional
// free-shipping threshold. Single-table design; zones / weight-based
// rates / refund policy live in a follow-up.

import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';

// Sprint 3 Story 2.4 — compute "today + N days" as an ISO date string
// (YYYY-MM-DD). Uses server-local day boundaries; for an India-only
// marketplace that's IST and consistent enough for buyer-side EDD.
// If/when we add weekend or holiday awareness, change here, not in
// every controller that calls quoteForCart.
function addDaysIsoDate(daysAhead: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return d.toISOString().slice(0, 10);
}
import { PrismaService } from '../../../../bootstrap/database/prisma.service';

export type RateType = 'FLAT' | 'FREE';

export interface ShippingOptionInput {
  name: string;
  deliveryDetails?: string | null;
  rateType?: RateType;
  priceInPaise?: bigint | number | string;
  transitMinDays?: number | null;
  transitMaxDays?: number | null;
  freeShippingMinCartPaise?: bigint | number | string | null;
  isActive?: boolean;
  sortOrder?: number;
}

export interface QuoteResult {
  optionId: string;
  name: string;
  deliveryDetails: string | null;
  rateType: RateType;
  priceInPaise: bigint;
  feeInPaise: bigint;
  isFree: boolean;
  freeShippingMinCartPaise: bigint | null;
  amountMoreForFreeShippingInPaise: bigint | null;
  transitMinDays: number | null;
  transitMaxDays: number | null;
  // Sprint 3 Story 2.4 — computed delivery-date range. Server-side so
  // the timezone is consistent (uses server day boundaries; the UI
  // doesn't have to think about DST or locale midnight). Null when
  // transit-day estimates aren't configured on the option. Format is
  // ISO date (YYYY-MM-DD), not full ISO timestamp, because EDD is a
  // day-granular concept — there's no business meaning to "delivered
  // at 14:32 on Friday".
  estimatedDeliveryFrom: string | null;
  estimatedDeliveryTo: string | null;
}

@Injectable()
export class ShippingOptionsService {
  private readonly logger = new Logger(ShippingOptionsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── Admin CRUD ───────────────────────────────────────────────

  async list(includeInactive = false) {
    return this.prisma.shippingOption.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async get(id: string) {
    const opt = await this.prisma.shippingOption.findUnique({ where: { id } });
    if (!opt) throw new NotFoundException('Shipping option not found');
    return opt;
  }

  async create(input: ShippingOptionInput) {
    this.validate(input);
    return this.prisma.shippingOption.create({
      data: this.toPrismaData(input, /* isCreate */ true),
    });
  }

  async update(id: string, input: Partial<ShippingOptionInput>) {
    await this.get(id); // throws if missing
    this.validate(input, /* allowPartial */ true);
    return this.prisma.shippingOption.update({
      where: { id },
      data: this.toPrismaData(input, /* isCreate */ false),
    });
  }

  /**
   * Soft delete — if any order references this option we keep the row
   * so the FK + the historical snapshot still resolve; we just flip
   * isActive=false so it disappears from the customer + admin lists.
   * Hard delete only when no orders point to it (clean dev/test path).
   */
  async delete(id: string): Promise<{ hardDeleted: boolean }> {
    const refCount = await this.prisma.masterOrder.count({
      where: { shippingOptionId: id },
    });
    if (refCount > 0) {
      await this.prisma.shippingOption.update({
        where: { id },
        data: { isActive: false },
      });
      return { hardDeleted: false };
    }
    await this.prisma.shippingOption.delete({ where: { id } });
    return { hardDeleted: true };
  }

  // ── Quote engine ─────────────────────────────────────────────

  /**
   * Given a cart subtotal (after discount), pick the best applicable
   * shipping option(s) and compute the fee with free-shipping logic.
   *
   * v1 strategy: return all active options, with each option's fee
   * computed against the cart. The checkout UI picks the cheapest by
   * default; the customer can switch. When zero options exist, callers
   * fall back to free shipping (preserves the legacy behavior).
   */
  async quoteForCart(args: { netCartValueInPaise: bigint }): Promise<QuoteResult[]> {
    const options = await this.list(/* includeInactive */ false);
    if (options.length === 0) return [];

    return options.map((opt) => this.quoteOne(opt, args.netCartValueInPaise));
  }

  /**
   * Server-side recompute for a specific option at place-order time.
   * Throws when the option no longer exists or has been disabled — the
   * caller is responsible for surfacing a clear error to the user.
   */
  async quoteOption(args: {
    optionId: string;
    netCartValueInPaise: bigint;
  }): Promise<QuoteResult> {
    const opt = await this.prisma.shippingOption.findUnique({
      where: { id: args.optionId },
    });
    if (!opt || !opt.isActive) {
      throw new BadRequestException(
        'The selected shipping option is no longer available. Please pick another.',
      );
    }
    return this.quoteOne(opt, args.netCartValueInPaise);
  }

  private quoteOne(
    opt: {
      id: string;
      name: string;
      deliveryDetails: string | null;
      rateType: string;
      priceInPaise: bigint;
      transitMinDays: number | null;
      transitMaxDays: number | null;
      freeShippingMinCartPaise: bigint | null;
    },
    netCartValueInPaise: bigint,
  ): QuoteResult {
    const price = BigInt(opt.priceInPaise.toString());
    const threshold = opt.freeShippingMinCartPaise
      ? BigInt(opt.freeShippingMinCartPaise.toString())
      : null;

    const alwaysFree = opt.rateType === 'FREE';
    const thresholdMet = threshold !== null && netCartValueInPaise >= threshold;
    const isFree = alwaysFree || thresholdMet;

    const amountMore =
      threshold !== null && !thresholdMet && !alwaysFree
        ? threshold - netCartValueInPaise
        : null;

    // Sprint 3 Story 2.4 — compute EDD date range from transit days.
    // `today` is captured once per quote so the from/to dates stay
    // self-consistent even if the call straddles midnight.
    const eddFrom = opt.transitMinDays != null
      ? addDaysIsoDate(opt.transitMinDays)
      : null;
    const eddTo = opt.transitMaxDays != null
      ? addDaysIsoDate(opt.transitMaxDays)
      : null;

    return {
      optionId: opt.id,
      name: opt.name,
      deliveryDetails: opt.deliveryDetails,
      rateType: opt.rateType as RateType,
      priceInPaise: price,
      feeInPaise: isFree ? 0n : price,
      isFree,
      freeShippingMinCartPaise: threshold,
      amountMoreForFreeShippingInPaise: amountMore,
      transitMinDays: opt.transitMinDays,
      transitMaxDays: opt.transitMaxDays,
      estimatedDeliveryFrom: eddFrom,
      estimatedDeliveryTo: eddTo,
    };
  }

  // ── Helpers ──────────────────────────────────────────────────

  private validate(
    input: Partial<ShippingOptionInput>,
    allowPartial = false,
  ): void {
    if (!allowPartial || input.name !== undefined) {
      if (!input.name?.trim()) {
        throw new BadRequestException('Name is required');
      }
    }
    if (input.priceInPaise !== undefined && input.priceInPaise !== null) {
      const v = BigInt(input.priceInPaise as any);
      if (v < 0n) {
        throw new BadRequestException('Price cannot be negative');
      }
    }
    if (
      input.transitMinDays != null &&
      input.transitMaxDays != null &&
      input.transitMinDays > input.transitMaxDays
    ) {
      throw new BadRequestException(
        'transitMinDays cannot exceed transitMaxDays',
      );
    }
    if (
      input.freeShippingMinCartPaise !== undefined &&
      input.freeShippingMinCartPaise !== null
    ) {
      const v = BigInt(input.freeShippingMinCartPaise as any);
      if (v < 0n) {
        throw new BadRequestException(
          'Free-shipping threshold cannot be negative',
        );
      }
    }
  }

  private toPrismaData(input: Partial<ShippingOptionInput>, isCreate: boolean) {
    const data: any = {};
    if (input.name !== undefined) data.name = input.name.trim();
    if (input.deliveryDetails !== undefined) {
      data.deliveryDetails = input.deliveryDetails?.trim() || null;
    }
    if (input.rateType !== undefined) data.rateType = input.rateType;
    if (input.priceInPaise !== undefined) {
      data.priceInPaise = BigInt(input.priceInPaise as any);
    } else if (isCreate) {
      data.priceInPaise = 0n;
    }
    if (input.transitMinDays !== undefined) {
      data.transitMinDays = input.transitMinDays ?? null;
    }
    if (input.transitMaxDays !== undefined) {
      data.transitMaxDays = input.transitMaxDays ?? null;
    }
    if (input.freeShippingMinCartPaise !== undefined) {
      data.freeShippingMinCartPaise =
        input.freeShippingMinCartPaise === null
          ? null
          : BigInt(input.freeShippingMinCartPaise as any);
    }
    if (input.isActive !== undefined) data.isActive = input.isActive;
    if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder;
    return data;
  }
}
