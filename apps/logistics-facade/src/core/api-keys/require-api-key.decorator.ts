import { applyDecorators, UseGuards } from '@nestjs/common';
import { ApiSecurity, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { ApiKeyAuthGuard } from './api-key-auth.guard';

/**
 * Apply this to any controller or handler that must be authenticated
 * by a peer service. Composes:
 *   • UseGuards(ApiKeyAuthGuard) — the actual auth check.
 *   • ApiSecurity('ApiKey')      — surfaces in /docs.
 *   • ApiUnauthorizedResponse    — documents the 401 shape.
 *
 * `@RequireApiKey()` on a controller protects every route; on a single
 * handler it scopes the requirement to that route. Apps/api uses the
 * same `@ApiSecurity` + `@UseGuards` composition for its admin guards.
 */
export const RequireApiKey = (): MethodDecorator & ClassDecorator =>
  applyDecorators(
    UseGuards(ApiKeyAuthGuard),
    ApiSecurity('ApiKey'),
    ApiUnauthorizedResponse({
      description:
        'Missing or invalid `Authorization: ApiKey <token>` header. Body follows RFC 7807 problem-details.',
    }),
  );
