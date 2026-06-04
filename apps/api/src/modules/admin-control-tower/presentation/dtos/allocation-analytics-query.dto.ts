import { IsIn, IsInt, IsOptional, Max, Min, IsDateString } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * Phase 233 — Allocation Analytics audit. Query DTOs for the
 * allocation dashboard endpoint and its drill-down.
 *
 * The numeric params (page/limit) use class-transformer `@Transform`
 * rather than `@Type(() => Number)` on purpose: `@Type` resolves its
 * factory via `Reflect.getMetadata` at decoration time, which throws
 * (`reflect-metadata` not loaded) when the DTO class is instantiated
 * directly inside a bare unit-spec context. `@Transform` reads the raw
 * value at validation time and is spec-safe. NaN is coerced back to
 * undefined so an invalid `?page=abc` falls through to the default
 * rather than poisoning the LIMIT/OFFSET arithmetic downstream.
 */

const toOptionalInt = ({ value }: { value: unknown }): number | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  const n =
    typeof value === 'number' ? value : parseInt(String(value), 10);
  return Number.isFinite(n) ? n : undefined;
};

const ALLOCATION_OUTCOMES = [
  'PRIMARY_SERVICEABLE',
  'FALLBACK_SERVICEABLE',
  'UNSERVICEABLE',
  'REASSIGNED',
] as const;

const ALLOCATION_EVENT_SOURCES = [
  'LIVE',
  'REALLOCATION',
  'MANUAL_REASSIGNMENT',
  'LISTING',
  'PREVIEW',
  'STOREFRONT',
] as const;

const NODE_TYPES = ['SELLER', 'FRANCHISE'] as const;

/**
 * Filters for `GET /admin/dashboard/allocation-analytics`. All optional —
 * an empty query returns the all-time, all-node-type aggregate. The
 * eventSource exclusion (LIVE/REALLOCATION/MANUAL_REASSIGNMENT only) is
 * applied unconditionally in the repository, independent of these.
 */
export class AllocationAnalyticsQueryDto {
  @IsOptional()
  @IsDateString({}, { message: 'fromDate must be an ISO-8601 date string' })
  fromDate?: string;

  @IsOptional()
  @IsDateString({}, { message: 'toDate must be an ISO-8601 date string' })
  toDate?: string;

  @IsOptional()
  @IsIn(NODE_TYPES, { message: 'nodeType must be one of SELLER, FRANCHISE' })
  nodeType?: (typeof NODE_TYPES)[number];
}

/**
 * Filters for the drill-down `GET /admin/dashboard/allocation-events`.
 * Returns raw allocation_logs rows. `outcome` and `eventSource` let an
 * operator inspect the rows behind any counter (e.g. every UNSERVICEABLE
 * decision, or every excluded PREVIEW row). `limit` is hard-capped at
 * 100 to bound the response.
 */
export class AllocationEventsQueryDto {
  @IsOptional()
  @IsIn(ALLOCATION_OUTCOMES, {
    message:
      'outcome must be one of PRIMARY_SERVICEABLE, FALLBACK_SERVICEABLE, UNSERVICEABLE, REASSIGNED',
  })
  outcome?: (typeof ALLOCATION_OUTCOMES)[number];

  @IsOptional()
  @IsIn(ALLOCATION_EVENT_SOURCES, {
    message:
      'eventSource must be one of LIVE, REALLOCATION, MANUAL_REASSIGNMENT, LISTING, PREVIEW, STOREFRONT',
  })
  eventSource?: (typeof ALLOCATION_EVENT_SOURCES)[number];

  @IsOptional()
  @IsDateString({}, { message: 'fromDate must be an ISO-8601 date string' })
  fromDate?: string;

  @IsOptional()
  @IsDateString({}, { message: 'toDate must be an ISO-8601 date string' })
  toDate?: string;

  @IsOptional()
  @IsIn(NODE_TYPES, { message: 'nodeType must be one of SELLER, FRANCHISE' })
  nodeType?: (typeof NODE_TYPES)[number];

  @IsOptional()
  @Transform(toOptionalInt)
  @IsInt({ message: 'page must be an integer' })
  @Min(1, { message: 'page must be >= 1' })
  page?: number;

  @IsOptional()
  @Transform(toOptionalInt)
  @IsInt({ message: 'limit must be an integer' })
  @Min(1, { message: 'limit must be >= 1' })
  @Max(100, { message: 'limit must not exceed 100' })
  limit?: number;
}
