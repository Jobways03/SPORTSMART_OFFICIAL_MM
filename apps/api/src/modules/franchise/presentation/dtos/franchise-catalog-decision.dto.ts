import { ArrayMaxSize, ArrayMinSize, IsArray, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/**
 * Phase 159n (audit #3/#14) — admin reject/stop decision body. The reason is
 * captured + persisted so the franchise sees WHY a mapping was rejected/stopped.
 */
export class CatalogMappingDecisionDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

/** Phase 159n (audit #15) — admin bulk approve. */
export class BulkApproveCatalogMappingsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID(undefined, { each: true })
  mappingIds!: string[];
}
