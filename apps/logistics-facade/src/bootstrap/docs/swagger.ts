import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/**
 * Mounts Swagger UI at /docs. The facade is internal-only, so we
 * publish one spec (unlike apps/api's split between internal +
 * public/v1 docs).
 *
 * `addSecurity` registers the ApiKey scheme — controllers/handlers
 * pick it up via @ApiSecurity('ApiKey') on their @RequireApiKey()
 * routes so the "Authorize" button in Swagger UI prompts for the
 * Authorization header.
 */
export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('SPORTSMART Logistics Facade')
    .setDescription(
      'Internal courier-aggregation API. Owns multi-carrier shipments, tracking, returns, NDR/RTO/QC and COD remittance. Authenticate every request with `Authorization: ApiKey <token>` issued by ops (see apps/logistics-facade/.env.example).',
    )
    .setVersion('0.1')
    .addSecurity('ApiKey', {
      type: 'apiKey',
      in: 'header',
      name: 'Authorization',
      description:
        'Format: `ApiKey <token>`. M0 accepts a single shared INTERNAL_API_KEY; M1 replaces this with per-caller keys.',
    })
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);
}
