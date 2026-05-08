import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/**
 * Phase 10 (PR 10.4) — Two specs published from one app:
 *
 *   /api/docs        — full internal spec, includes admin / seller /
 *                      franchise / affiliate routes. Bearer auth via
 *                      per-actor JWTs.
 *
 *   /public/v1/docs  — partner-facing spec, only routes whose
 *                      controller path starts with `/public/v1`.
 *                      Auth scheme is the API-key bearer.
 *
 * The split is path-prefix driven so a controller's contribution to
 * the public spec is decided by where it's mounted, not by tag soup
 * scattered across decorators. Today no controllers live under
 * `/public/v1` — they'll arrive in follow-up PRs as we curate the
 * partner surface. Until then `/public/v1/docs` renders an empty
 * spec with the security definition in place.
 */
export function setupSwagger(app: INestApplication): void {
  const internal = new DocumentBuilder()
    .setTitle('SPORTSMART API (internal)')
    .setDescription(
      'Multi-seller sports marketplace API. Internal surface — admin, seller, franchise, affiliate, customer routes. Bearer auth uses the per-actor JWT minted by /auth/* endpoints.',
    )
    .setVersion('1.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
    .build();
  const internalDoc = SwaggerModule.createDocument(app, internal);
  SwaggerModule.setup('api/docs', app, internalDoc);

  // Public partner surface. `include` filtering by path prefix is
  // done after the document is built — Nest's `include` option only
  // accepts module classes, not path patterns, so we copy the document
  // and prune.
  const publicDoc = clonePublicSpec(internalDoc);
  SwaggerModule.setup('public/v1/docs', app, publicDoc);
}

/**
 * Returns a copy of the OpenAPI document with only the
 * `/public/v1/...` paths retained and the security scheme replaced
 * with the API-key bearer.
 */
function clonePublicSpec(internalDoc: any): any {
  const doc = JSON.parse(JSON.stringify(internalDoc));

  doc.info = {
    ...doc.info,
    title: 'SPORTSMART Public API',
    description:
      'Partner-facing REST API. Authenticate with `Authorization: Bearer sk_live_<key>` (use `sk_test_<key>` against the sandbox).',
  };

  // Filter paths.
  if (doc.paths && typeof doc.paths === 'object') {
    const filtered: Record<string, unknown> = {};
    for (const [path, ops] of Object.entries(doc.paths)) {
      if (path.startsWith('/public/v1/')) {
        filtered[path] = ops;
      }
    }
    doc.paths = filtered;
  }

  // Swap security to API-key bearer.
  doc.components = doc.components ?? {};
  doc.components.securitySchemes = {
    ApiKey: {
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'API Key',
      description:
        'Public API bearer token. Issue via `POST /admin/api-keys` with environment LIVE or TEST.',
    },
  };
  doc.security = [{ ApiKey: [] }];

  return doc;
}
