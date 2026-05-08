import { Global, Module } from '@nestjs/common';
import { MoneyDualWriteHelper } from './money-dual-write.helper';

/**
 * Global module for the Money Phase-1 helpers. Same pattern as the
 * idempotency / case-duplicate modules — domain modules inject without
 * needing an explicit import.
 */
@Global()
@Module({
  providers: [MoneyDualWriteHelper],
  exports: [MoneyDualWriteHelper],
})
export class MoneyModule {}
