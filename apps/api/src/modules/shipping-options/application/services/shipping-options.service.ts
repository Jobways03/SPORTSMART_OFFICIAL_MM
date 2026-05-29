// Shipping options v1 — Shopify-style flat shipping fee with optional
// free-shipping threshold. Single-table design; zones / weight-based
// rates / refund policy live in a follow-up.

import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  Optional,
  ConflictException,
} from '@nestjs/common';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';

// Phase 91 (2026-05-23) — Gap #21 IST-aware EDD. Pre-Phase-91 the
// helper used `new Date()` server-local; for a non-IST server this
// produced wrong dates. Force the IST offset so a 23:00 UTC server
// clock still computes 04:30 IST → next day correctly.
function addDaysIsoDate(daysAhead: number): string {
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  ist.setUTCDate(ist.getUTCDate() + daysAhead);
  return ist.toISOString().slice(0, 10);
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

// Phase 91 — Gap #19 platform price cap. Mirrored from
// ShippingPricingService.MAX_PRICE_PAISE to avoid the cyclic import.
const PLATFORM_PRICE_CAP_PAISE = 1_00_000_00; // ₹1,00,000

@Injectable()
export class ShippingOptionsService {
  private readonly logger = new Logger(ShippingOptionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    // Phase 91 — Gap #11 event emission + Gap #10 audit log.
    @Optional() private readonly eventBus?: EventBusService,
  ) {}

  private emit(eventName: string, payload: Record<string, unknown>): void {
    if (!this.eventBus) return;
    void this.eventBus
      .publish({
        eventName,
        aggregate: 'ShippingOption',
        aggregateId: String(payload.optionId ?? ''),
        occurredAt: new Date(),
        payload,
      })
      .catch(() => undefined);
  }

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

  async create(input: ShippingOptionInput, actorId?: string | null) {
    this.validate(input);
    try {
      const created = await this.prisma.shippingOption.create({
        data: this.toPrismaData(input, /* isCreate */ true),
      });
      this.emit('shipping.option.created', {
        optionId: created.id,
        name: created.name,
        actorId: actorId ?? null,
      });
      return created;
    } catch (err: any) {
      // Phase 91 — Gap #8 name uniqueness collision → clean 409.
      if (err?.code === 'P2002') {
        throw new ConflictException(
          'A shipping option with this name already exists.',
        );
      }
      throw err;
    }
  }

  async update(
    id: string,
    input: Partial<ShippingOptionInput>,
    actorId?: string | null,
  ) {
    await this.get(id);
    this.validate(input, /* allowPartial */ true);
    try {
      const updated = await this.prisma.shippingOption.update({
        where: { id },
        data: this.toPrismaData(input, /* isCreate */ false),
      });
      this.emit('shipping.option.updated', {
        optionId: id,
        actorId: actorId ?? null,
        changes: Object.keys(input ?? {}),
      });
      return updated;
    } catch (err: any) {
      if (err?.code === 'P2002') {
        throw new ConflictException(
          'A shipping option with this name already exists.',
        );
      }
      throw err;
    }
  }

  /**
   * Soft delete — if any order references this option we keep the row
   * so the FK + the historical snapshot still resolve; we just flip
   * isActive=false so it disappears from the customer + admin lists.
   * Hard delete only when no orders point to it (clean dev/test path).
   */
  async delete(
    id: string,
    actorId?: string | null,
  ): Promise<{ hardDeleted: boolean }> {
    const refCount = await this.prisma.masterOrder.count({
      where: { shippingOptionId: id },
    });
    if (refCount > 0) {
      await this.prisma.shippingOption.update({
        where: { id },
        data: { isActive: false },
      });
      this.emit('shipping.option.deactivated', {
        optionId: id,
        actorId: actorId ?? null,
        reason: 'referenced by past orders',
      });
      return { hardDeleted: false };
    }
    await this.prisma.shippingOption.delete({ where: { id } });
    this.emit('shipping.option.deleted', {
      optionId: id,
      actorId: actorId ?? null,
    });
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
      // Phase 91 — Gap #19 upper-bound cap (₹1,00,000). Admin typo
      // protection — a ₹50 lakh shipping option would survive today.
      if (v > BigInt(PLATFORM_PRICE_CAP_PAISE)) {
        throw new BadRequestException(
          `Price exceeds platform cap of ₹${PLATFORM_PRICE_CAP_PAISE / 100}.`,
        );
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
