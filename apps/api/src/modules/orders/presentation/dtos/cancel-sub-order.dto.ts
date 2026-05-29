import {
  IsBoolean,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';

/**
 * Phase 81 (2026-05-22) — sub-order cancel audit Gap #11/#12/#19.
 *
 * Pre-Phase-81 the admin cancel endpoint accepted an inline
 * `{ reason?: string }` with no class-validator decorators —
 * the UI happily sent `undefined` if the textarea was blank,
 * the server logged a canned "Admin cancellation" string, and
 * an attacker could submit a 1 MB note.
 *
 * The DTO enforces:
 *   • reason mandatory at the application layer (10..500 chars).
 *     The schema column is nullable for backwards-compat with the
 *     backfilled pre-Phase-81 rows, so the DTO does the heavy
 *     lifting at the boundary.
 *   • force is the gate for SHIPPED / FULFILLED sub-orders. The
 *     controller checks `orders.subOrder.cancel.force` permission
 *     before allowing it.
 */
export class CancelSubOrderDto {
  // Phase 81 — Gap #1/#11. Server-side enforcement of the reason
  // requirement; the DTO mirrors the seller/franchise reject DTO
  // shape from Phase 80.
  @IsString({ message: 'reason is required' })
  @Length(10, 500, {
    message: 'reason must be between 10 and 500 characters',
  })
  reason!: string;

  // Phase 81 — Gap #8/#16. Required to bypass the standard
  // pre-shipment cancel gate. Gated by the additional
  // `orders.subOrder.cancel.force` permission at the controller.
  @IsOptional()
  @IsBoolean({ message: 'force must be a boolean' })
  force?: boolean;
}
