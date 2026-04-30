import {
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { MenuLinkType } from '@prisma/client';

export class CreateMenuDto {
  @IsString()
  handle: string;

  @IsString()
  name: string;
}

export class UpdateMenuDto {
  @IsOptional()
  @IsString()
  handle?: string;

  @IsOptional()
  @IsString()
  name?: string;
}

export class CreateItemDto {
  @IsString()
  label: string;

  @IsOptional()
  @IsEnum(MenuLinkType)
  linkType?: MenuLinkType;

  @IsOptional()
  @IsString()
  linkRef?: string | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  filterTags?: string[];

  @IsOptional()
  @IsString()
  parentId?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;
}

export class UpdateItemDto {
  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsEnum(MenuLinkType)
  linkType?: MenuLinkType;

  @IsOptional()
  @IsString()
  linkRef?: string | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  filterTags?: string[];

  @IsOptional()
  @IsString()
  parentId?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;
}

export class ReorderMoveDto {
  @IsString()
  id: string;

  @IsOptional()
  @IsString()
  parentId: string | null;

  @IsInt()
  @Min(0)
  position: number;
}

export class ReorderItemsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReorderMoveDto)
  moves: ReorderMoveDto[];
}
