// Phase 243 (#1/#7) — update body. Everything optional (PartialType) and
// `status` OMITTED: status transitions are forbidden on the generic update
// path (an admin could otherwise flip EXPIRED→ACTIVE silently) and must go
// through the dedicated FSM endpoint PUT /admin/discounts/:id/status.
// `type` also becomes optional (a campaign's type is set at create).
import { PartialType, OmitType } from '@nestjs/swagger';
import { IsInt, IsOptional } from 'class-validator';
import { CreateDiscountDto } from './create-discount.dto';

export class UpdateDiscountDto extends PartialType(
  OmitType(CreateDiscountDto, ['status'] as const),
) {
  // #8 / OCC — the version the client last read. When supplied, the service
  // rejects a stale-write collision (two admins editing the same campaign).
  @IsOptional()
  @IsInt()
  expectedVersion?: number;
}
