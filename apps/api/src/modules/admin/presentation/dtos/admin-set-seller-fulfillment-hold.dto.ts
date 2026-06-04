import { IsNotEmpty, IsString, MinLength, MaxLength, Matches } from 'class-validator';

/**
 * Phase 232 (eligible-node / allocation-preview audit) — body for placing a
 * risk/fraud FULFILLMENT HOLD on a seller. A held seller is excluded from the
 * allocation engine (it can be neither auto-routed nor manually reassigned new
 * orders), so the reason is MANDATORY: ops must record *why* the node was
 * benched before it silently stops receiving work.
 *
 * Mirrors FranchiseLedgerAdjustmentDto's reason guard (5–500 chars + charset
 * allow-list that blocks markup/control chars that could become an XSS/formula
 * payload in a future PDF/email/CSV render).
 */
export class AdminSetSellerFulfillmentHoldDto {
  @IsNotEmpty({ message: 'Reason is required' })
  @IsString({ message: 'Reason must be a string' })
  @MinLength(5, { message: 'Reason must be at least 5 characters' })
  @MaxLength(500, { message: 'Reason must not exceed 500 characters' })
  @Matches(/^[\w\s.,!?():@/\-\n₹%+*='"&#]*$/u, {
    message: 'Reason contains unsupported characters',
  })
  reason!: string;
}
