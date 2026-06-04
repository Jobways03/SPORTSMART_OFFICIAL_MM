/**
 * @sportsmart/logistics-contracts
 *
 * Single source of truth for the wire-shape of every payload that
 * crosses the logistics-facade boundary. Every export is a Zod
 * schema paired with a TS type inferred from it (`z.infer<>`), so:
 *
 *   • Runtime validation (facade controllers, partner adapters) and
 *     compile-time typing (apps/api consumers) come from the same
 *     definition. There is no drift between "what we accept" and
 *     "what we say we accept".
 *
 *   • Bumping a field's shape is a single-file change that breaks
 *     both sides of the boundary at compile time — refactors stay
 *     honest.
 *
 * Files are organised by domain concept rather than by HTTP route so
 * the same schema can be reused on inbound requests, outbound webhook
 * payloads, and event envelopes.
 */
export * from './partner';
export * from './shipment';
export * from './tracking';
export * from './return';
export * from './ndr';
export * from './rto';
export * from './qc';
export * from './cod';
export * from './serviceability';
export * from './errors';
