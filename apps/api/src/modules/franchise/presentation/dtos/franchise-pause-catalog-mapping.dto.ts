import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Body for a franchise self-pause (PATCH franchise/catalog/mappings/:id/pause).
 * `reason` is optional, stored on the mapping + its history event so the
 * pause is explicable later. Resume takes no body.
 */
export class FranchisePauseCatalogMappingDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
