import { IsOptional, Matches } from 'class-validator';

/**
 * Phase 159s (POS report audit #10) — validate the report date instead of
 * blindly `new Date(query.date)`. A bad value (?date=garbage) previously built
 * an Invalid Date that propagated NaN boundaries into the query. Strict
 * calendar-date shape only; the service additionally rejects future dates.
 */
export class PosReportQueryDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'date must be a calendar date in YYYY-MM-DD format',
  })
  date?: string;

  // Optional export format. Anything other than "csv" returns JSON.
  @IsOptional()
  @Matches(/^(json|csv)$/, { message: 'format must be json or csv' })
  format?: string;
}
