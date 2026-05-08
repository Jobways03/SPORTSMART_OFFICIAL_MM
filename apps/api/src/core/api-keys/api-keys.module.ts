import { Global, Module } from '@nestjs/common';
import { ApiKeyService } from './api-key.service';
import { ApiKeyRateLimiter } from './api-key-rate-limiter.service';
import { ApiKeyAuthGuard } from './api-key-auth.guard';

/**
 * Phase 10 (PR 10.1) — public API key infrastructure. Domain
 * controllers protecting public endpoints attach `@UseGuards(ApiKeyAuthGuard)`
 * to authenticate. Per-route scope enforcement comes from
 * `apiKeyHasScope()` inside the handler, or via a future @Scopes
 * decorator (out of scope for v1).
 */
@Global()
@Module({
  providers: [ApiKeyService, ApiKeyRateLimiter, ApiKeyAuthGuard],
  exports: [ApiKeyService, ApiKeyRateLimiter, ApiKeyAuthGuard],
})
export class ApiKeysModule {}
