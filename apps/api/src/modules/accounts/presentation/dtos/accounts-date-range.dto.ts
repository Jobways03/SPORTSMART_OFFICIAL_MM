import { IsOptional, IsDateString, IsNumberString } from 'class-validator';

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
