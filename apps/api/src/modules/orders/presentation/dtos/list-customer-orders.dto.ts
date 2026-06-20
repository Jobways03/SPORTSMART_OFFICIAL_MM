import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Phase 197 (My-Orders audit #5/#7) — typed query for the customer
 * order listing.
 *
 * Pre-Phase-197 the controller hand-parsed `page` / `limit` from raw
 * query strings with `parseInt`, and there was NO server-side status
 * filter at all — the storefront computed active/delivered/cancelled
 * buckets on whatever single page it had loaded, so the counts were
 * wrong the moment a customer had more than one page of orders.
 *
 *   • page / limit are validated + bounded here (global ValidationPipe
 *     runs `transform`, so `@Type(() => Number)` coerces the string).
 *   • status is an OPTIONAL server-side bucket filter. `all` (or
 *     omitted) preserves the legacy "everything" behaviour.
 */
export enum CustomerOrderStatusBucket {
  ALL = 'all',
  ACTIVE = 'active',
  DELIVERED = 'delivered',
  CANCELLED = 'cancelled',
  // Online-payment audit — in-flight unpaid ONLINE orders (orderStatus
  // PENDING_PAYMENT, payment still PENDING/CREATED). Kept out of `all`/`active`
  // so a failed/abandoned gateway payment never shows as a real "Processing"
  // order; surfaced only in the storefront's "Complete your payment" strip.
  AWAITING_PAYMENT = 'awaiting_payment',
}

export class ListCustomerOrdersDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page must be an integer' })
  @Min(1, { message: 'page must be >= 1' })
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit must be an integer' })
  @Min(1, { message: 'limit must be >= 1' })
  @Max(50, { message: 'limit must not exceed 50' })
  limit?: number;

  @IsOptional()
  @IsEnum(CustomerOrderStatusBucket, {
    message:
      'status must be one of: all, active, delivered, cancelled, awaiting_payment',
  })
  status?: CustomerOrderStatusBucket;
}
