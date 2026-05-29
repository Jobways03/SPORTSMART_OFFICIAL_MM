import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Length,
} from 'class-validator';

/**
 * Phase 78 (2026-05-22) — reassign audit Gaps #1, #4, #11.
 *
 * Pre-Phase-78 the reassign endpoint accepted an inline `{ nodeType?,
 * nodeId?, sellerId?, reason? }` object with no validation:
 *   - reason was optional → admins skipped it → audit log got a canned
 *     fallback string → compliance / post-mortem investigation impossible
 *   - nodeType was not enum-validated at the pipe layer (only at the
 *     service-side string compare) so a typo returned a 400 deeper in
 *     the call stack
 *   - nodeId could be any string → easy to fat-finger a malformed id
 *     past validation and get a 404 from the DB
 *
 * The DTO enforces all of these at the pipe layer. The controller
 * normalises the legacy `{ sellerId }` shape into the canonical
 * `{ nodeType: 'SELLER', nodeId }` before invoking the service.
 */
export class ReassignSubOrderDto {
  /**
   * Canonical target shape. Optional only because the legacy form
   * (`sellerId` below) is still accepted; if `nodeType` is supplied,
   * `nodeId` must be too.
   */
  @IsOptional()
  @IsEnum(['SELLER', 'FRANCHISE'] as const, {
    message: 'nodeType must be SELLER or FRANCHISE',
  })
  nodeType?: 'SELLER' | 'FRANCHISE';

  @IsOptional()
  @IsUUID('4', { message: 'nodeId must be a UUID' })
  nodeId?: string;

  /**
   * Legacy form — bare seller id. The controller maps it to
   * `{ nodeType: 'SELLER', nodeId: sellerId }`.
   */
  @IsOptional()
  @IsUUID('4', { message: 'sellerId must be a UUID' })
  sellerId?: string;

  /**
   * MANDATORY at the application layer. The compliance + post-mortem
   * use cases require a human-written reason; the prompt explicitly
   * states "reassignment reason required." Min 10 chars deters
   * one-character placeholder reasons; max 500 caps DB row size and
   * the audit log payload.
   */
  @IsString({ message: 'reason is required' })
  @Length(10, 500, {
    message: 'reason must be between 10 and 500 characters',
  })
  reason!: string;

  /**
   * Phase 78 — Gap #19. Required to bypass the ACCEPTED-state
   * precondition. Gated by the additional `orders.reassign.force`
   * permission at the controller layer.
   */
  @IsOptional()
  @IsBoolean({ message: 'force must be a boolean' })
  force?: boolean;
}
