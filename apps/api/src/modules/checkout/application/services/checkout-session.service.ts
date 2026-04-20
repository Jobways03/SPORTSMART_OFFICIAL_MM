import { Injectable } from '@nestjs/common';
import { RedisService } from '../../../../bootstrap/cache/redis.service';

// ── Checkout session types ───────────────────────────────────────────────

export interface CheckoutItemAllocation {
  cartItemId: string;
  productId: string;
  variantId: string | null;
  productTitle: string;
  variantTitle: string | null;
  imageUrl: string | null;
  sku: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  serviceable: boolean;
  unserviceableReason?: string;
  allocatedSellerId: string | null;
  allocatedSellerName: string | null;
  allocatedNodeType: 'SELLER' | 'FRANCHISE';
  allocatedMappingId: string | null;
  estimatedDeliveryDays: number | null;
  reservationId: string | null;
}

export interface CheckoutSession {
  customerId: string;
  addressId: string;
  addressSnapshot: Record<string, any>;
  items: CheckoutItemAllocation[];
  totalAmount: number;
  serviceableAmount: number;
  itemCount: number;
  allServiceable: boolean;
  unserviceableCount: number;
  createdAt: string;
  expiresAt: string;
}

// ── Service: owns session storage concerns ───────────────────────────────

const SESSION_TTL_SECONDS = 15 * 60; // 15 minutes
const KEY_PREFIX = 'checkout:session:';

@Injectable()
export class CheckoutSessionService {
  constructor(private readonly redis: RedisService) {}

  get ttlSeconds(): number {
    return SESSION_TTL_SECONDS;
  }

  async get(customerId: string): Promise<CheckoutSession | null> {
    const session = await this.redis.get<CheckoutSession>(this.key(customerId));
    if (!session) return null;

    // Check expiry (Redis TTL handles cleanup, but verify for safety)
    if (new Date(session.expiresAt) < new Date()) {
      await this.delete(customerId);
      return null;
    }

    return session;
  }

  async save(customerId: string, session: CheckoutSession): Promise<void> {
    await this.redis.set(this.key(customerId), session, SESSION_TTL_SECONDS);
  }

  async delete(customerId: string): Promise<void> {
    await this.redis.del(this.key(customerId));
  }

  isExpired(session: CheckoutSession): boolean {
    return new Date(session.expiresAt) < new Date();
  }

  buildExpiresAt(): string {
    return new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();
  }

  private key(customerId: string): string {
    return `${KEY_PREFIX}${customerId}`;
  }
}
