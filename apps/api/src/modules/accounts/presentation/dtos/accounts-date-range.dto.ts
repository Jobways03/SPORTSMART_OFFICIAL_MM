import { IsOptional, IsDateString, IsString, MaxLength } from 'class-validator';

export class AccountsDateRangeDto {
  @IsOptional()
  @IsDateString()
  fromDate?: string;

  @IsOptional()
  @IsDateString()
  toDate?: string;
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
  @IsOptional()
  @IsString()
  page?: string;

  @IsOptional()
  @IsString()
  limit?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  sourceType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  status?: string;
}
