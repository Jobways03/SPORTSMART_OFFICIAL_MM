import { Transform } from 'class-transformer';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class FranchiseSettlementPayDto {
  // Phase 159v (audit #10/#17) — the payment reference is the bank UTR / IMPS
  // ref / cheque number recorded against a money-out. Previously typed as a
  // bare non-empty string, so it accepted whitespace-only values, 10k-char
  // payloads, and control/injection characters that flow straight into the
  // audit log and downstream Tally export. Bounds + charset close that.
  //
  // NOTE: we deliberately do NOT hard-pin to the strict 12–22 char NEFT/RTGS
  // UTR pattern — IMPS refs, cheque numbers and manual-transfer references are
  // shorter/longer and mixed-case, and rejecting them would block legitimate
  // payouts. The charset (alphanumerics plus - / spaces) blocks injection while
  // accepting every real Indian bank reference format.
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsNotEmpty({ message: 'Payment reference is required' })
  @IsString({ message: 'Payment reference must be a string' })
  @MinLength(6, { message: 'Payment reference must be at least 6 characters' })
  @MaxLength(64, { message: 'Payment reference must be at most 64 characters' })
  @Matches(/^[A-Za-z0-9][A-Za-z0-9\-/ ]*$/, {
    message:
      'Payment reference may contain only letters, digits, spaces, hyphens and slashes',
  })
  paymentReference!: string;

  // Optional payout reconciliation metadata (mirrors the seller flow). Method
  // is a short label (NEFT / IMPS / RTGS / RAZORPAYX / CHEQUE / MANUAL); the
  // proof URL points at a bank statement / payout receipt.
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString({ message: 'Payment method must be a string' })
  @MaxLength(32, { message: 'Payment method must be at most 32 characters' })
  @Matches(/^[A-Za-z0-9 _-]*$/, {
    message: 'Payment method may contain only letters, digits, spaces, underscores and hyphens',
  })
  paymentMethod?: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString({ message: 'Payment proof URL must be a string' })
  @MaxLength(1024, { message: 'Payment proof URL must be at most 1024 characters' })
  paymentProofUrl?: string;
}
