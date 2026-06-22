import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marks a route (or whole controller) as intentionally unauthenticated.
 *
 * Re-introduced (alongside GlobalAuthGuard) to ship the global-guard model
 * the codebase previously deferred. The guard treats the ABSENCE of both an
 * auth `@UseGuards` AND `@Public()` as a misconfiguration: it warns in SOAK
 * mode and 401s under GLOBAL_AUTH_GUARD_STRICT. So genuinely-public endpoints
 * (auth, health, webhooks, storefront browse, signed-token resources) must
 * say so explicitly with `@Public()`.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
