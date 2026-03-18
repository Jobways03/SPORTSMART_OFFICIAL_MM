import { IsString, IsArray, ArrayNotEmpty, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class ManualOptionDto {
  @IsString()
  name: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  values: string[];
}

export class GenerateManualVariantsDto {
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => ManualOptionDto)
  options: ManualOptionDto[];
}
