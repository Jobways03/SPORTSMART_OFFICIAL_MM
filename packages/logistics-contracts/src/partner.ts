import { z } from 'zod';

/**
 * Canonical partner identifiers used across every facade table, event,
 * and webhook payload. New couriers MUST be added here AND have a
 * concrete `CourierGatewayPort` registered in the facade resolver — a
 * partner is only "known" once both sides exist.
 *
 * Adding a new code is a THREE-step change that lands in a single PR:
 *
 *   1. Extend this Zod enum so controllers + webhook validators accept
 *      the code at the API boundary.
 *   2. Extend the Prisma `Partner` enum in
 *      `apps/logistics-facade/prisma/schema/index.prisma` so persisted
 *      rows can carry the value (and write the matching
 *      `ALTER TYPE … ADD VALUE` migration — Postgres won't accept new
 *      enum values added via Prisma generate alone).
 *   3. Register a concrete `CourierGatewayPort` implementation in
 *      `apps/logistics-facade/src/modules/shipments/application/factories/courier-gateway.resolver.ts`
 *      so the facade can actually resolve a gateway for the new code.
 *
 * Missing any of the three results in either a Zod validation error
 * (step 1), a DB write failure (step 2), or a runtime resolver miss
 * (step 3) — all loud, none silent.
 */
export const PartnerCode = z.enum(['DELHIVERY', 'SHADOWFAX']);

export type PartnerCode = z.infer<typeof PartnerCode>;

/**
 * Loose partner code accepted on free-form fields (e.g. legacy webhook
 * payloads that pre-date a partner being formally registered). Always
 * a `string`; downstream services that need a strongly-typed partner
 * MUST re-parse with `PartnerCode`.
 */
export const PartnerCodeLoose = z.string().min(2).max(32).regex(/^[A-Z0-9_]+$/);
export type PartnerCodeLoose = z.infer<typeof PartnerCodeLoose>;
