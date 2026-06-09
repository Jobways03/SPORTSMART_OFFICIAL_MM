import {
  IsOptional,
  IsDateString,
  IsString,
  IsNumberString,
  MaxLength,
} from 'class-validator';

export class AccountsDateRangeDto {
  @IsOptional()
  @IsDateString()
  fromDate?: string;

  @IsOptional()
  @IsDateString()
  toDate?: string;

  // The paginated drill endpoints (ledger / pos-sales / settlements) bind this
  // DTO via @Query() and ALSO read page/limit via @Query('page'/'limit'). With
  // the global ValidationPipe's forbidNonWhitelisted, page/limit on the query
  // string were rejected ("property page should not exist") because they
  // weren't whitelisted here. Validated as numeric strings; handlers parseInt
  // + clamp. Non-paginated endpoints simply never send them.
  @IsOptional()
  @IsNumberString()
  page?: string;

  @IsOptional()
  @IsNumberString()
  limit?: string;
}

/**
 * Date-range + pagination/filter query for the paginated accounts drill-downs
 * (seller / franchise ledger, settlements, pos-sales, commission-records).
 *
 * These handlers read `page`/`limit`/`sourceType`/`status` via individual
 * `@Query('x')` params BUT also bind the whole query to a DTO for date-range
 * validation. With the global `forbidNonWhitelisted` ValidationPipe, binding to
 * the bare AccountsDateRangeDto rejected the extra params ("property page should
 * not exist"), 400-ing every drill page the moment it paginated. Declaring them
 * here whitelists them; the handlers still parse the raw strings themselves.
 */
export class AccountsPagedQueryDto extends AccountsDateRangeDto {
  // page/limit are inherited from AccountsDateRangeDto (validated there as
  // numeric strings + whitelisted); only the paged-drill-specific filters are
  // declared here.
  @IsOptional()
  @IsString()
  @MaxLength(64)
  sourceType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  status?: string;
}
