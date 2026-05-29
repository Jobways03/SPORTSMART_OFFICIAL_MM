import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import {
  SELLER_RESPOND_DECISIONS,
  SELLER_CONTEST_REASON_CATEGORIES,
  type SellerContestReasonCategory,
} from './seller-respond.dto';

// Phase 95 (2026-05-23) — Phase 94 deferred #25 closure.
//
// Seller flips their prior ACCEPTED↔CONTESTED while still inside the
// original window + 1h grace. Past the grace window the decision is
// final.
export class SellerRescindResponseDto {
  @IsIn(SELLER_RESPOND_DECISIONS as unknown as string[], {
    message: 'newDecision must be ACCEPTED or CONTESTED',
  })
  newDecision!: 'ACCEPTED' | 'CONTESTED';

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsOptional()
  @IsIn(SELLER_CONTEST_REASON_CATEGORIES as unknown as string[])
  contestReasonCategory?: SellerContestReasonCategory;
}
