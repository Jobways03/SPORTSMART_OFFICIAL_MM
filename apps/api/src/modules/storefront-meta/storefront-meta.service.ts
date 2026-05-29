import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../bootstrap/database/prisma.service';

// Slow-moving public stats surfaced on HomeScreen + AboutScreen.
// All fields are optional so consumers can degrade gracefully if a
// count throws (a malformed table shouldn't take the home page down).
export interface StorefrontStatsDto {
  athletes?: number;
  brands?: number;
  products?: number;
  stores?: number;
  averageRating?: number;
}

// Storefront-level configuration. Backed by process.env with sensible
// defaults so devs aren't forced to touch .env to run the API locally.
// Each key is read once at request time — these are cheap reads and
// the values change so infrequently that caching them isn't worth the
// staleness risk after an env update + restart.
export interface StorefrontConfigDto {
  freeShippingThreshold: number;
  shippingFee: number;
  gstRate: number;
  membershipPriceYearly: number;
  supportSlaHours: number;
  flashSaleDurationHours: number;
  currency: string;
}

export interface StorefrontStoresSummaryDto {
  total: number;
  topCities: string[];
}

const DEFAULTS = {
  freeShippingThreshold: 999,
  shippingFee: 49,
  gstRate: 0.18,
  membershipPriceYearly: 999,
  supportSlaHours: 4,
  flashSaleDurationHours: 8,
  currency: 'INR',
};

function readNumber(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

@Injectable()
export class StorefrontMetaService {
  private readonly logger = new Logger(StorefrontMetaService.name);

  constructor(private readonly prisma: PrismaService) {}

  // Aggregate counts for the HomeScreen stats strip. Each count is
  // wrapped in its own try/catch so one slow / failing query doesn't
  // wipe out the entire response — partial data is better than none
  // for a non-critical surface.
  async getStats(): Promise<StorefrontStatsDto> {
    const safe = async <T>(label: string, fn: () => Promise<T>): Promise<T | undefined> => {
      try {
        return await fn();
      } catch (err) {
        this.logger.warn(`stats.${label} failed: ${(err as Error).message}`);
        return undefined;
      }
    };

    const [athletes, brands, products] = await Promise.all([
      safe('athletes', () =>
        this.prisma.user.count({ where: { status: 'ACTIVE' } }),
      ),
      safe('brands', () =>
        this.prisma.brand.count({ where: { isActive: true } }),
      ),
      safe('products', () =>
        this.prisma.product.count({ where: { status: 'ACTIVE' } }),
      ),
    ]);

    return {
      athletes,
      brands,
      products,
      // Stores + averageRating intentionally omitted — no Store model
      // yet, and there's no aggregated review table to read from.
      // Both will get populated as those domains land.
    };
  }

  getConfig(): StorefrontConfigDto {
    return {
      freeShippingThreshold: readNumber(
        'STOREFRONT_FREE_SHIPPING_THRESHOLD',
        DEFAULTS.freeShippingThreshold,
      ),
      shippingFee: readNumber('STOREFRONT_SHIPPING_FEE', DEFAULTS.shippingFee),
      gstRate: readNumber('STOREFRONT_GST_RATE', DEFAULTS.gstRate),
      membershipPriceYearly: readNumber(
        'STOREFRONT_MEMBERSHIP_PRICE_YEARLY',
        DEFAULTS.membershipPriceYearly,
      ),
      supportSlaHours: readNumber(
        'STOREFRONT_SUPPORT_SLA_HOURS',
        DEFAULTS.supportSlaHours,
      ),
      flashSaleDurationHours: readNumber(
        'STOREFRONT_FLASH_SALE_DURATION_HOURS',
        DEFAULTS.flashSaleDurationHours,
      ),
      currency: process.env.STOREFRONT_CURRENCY || DEFAULTS.currency,
    };
  }

  // Stores summary is a stub for now — no Store / RetailBranch model
  // exists. Returning a well-formed empty response lets the mobile
  // client render its fallback ("Find a store near you") and stops
  // the 404 noise in dev. Swap the impl when a Store model lands.
  async getStoresSummary(): Promise<StorefrontStoresSummaryDto> {
    return { total: 0, topCities: [] };
  }
}
