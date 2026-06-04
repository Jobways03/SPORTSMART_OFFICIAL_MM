import { Global, Module } from '@nestjs/common';
import { ApiKeyAuthGuard } from './api-key-auth.guard';

/**
 * Global module so any controller can apply `@UseGuards(ApiKeyAuthGuard)`
 * (or the `@RequireApiKey()` decorator wrapper) without importing the
 * module explicitly.
 */
@Global()
@Module({
  providers: [ApiKeyAuthGuard],
  exports: [ApiKeyAuthGuard],
})
export class ApiKeysModule {}
