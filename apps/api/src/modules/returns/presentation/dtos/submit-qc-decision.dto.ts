import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

const QC_OUTCOMES = ['APPROVED', 'REJECTED', 'PARTIAL', 'DAMAGED'] as const;

export class QcDecisionItemDto {
  @IsNotEmpty()
  @IsUUID()
  returnItemId: string;

  @IsNotEmpty()
  @IsIn(QC_OUTCOMES as unknown as string[])
  qcOutcome: 'APPROVED' | 'REJECTED' | 'PARTIAL' | 'DAMAGED';

  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  qcQuantityApproved: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  qcNotes?: string;
}

export class SubmitQcDecisionDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => QcDecisionItemDto)
  decisions: QcDecisionItemDto[];

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  overallNotes?: string;
}
