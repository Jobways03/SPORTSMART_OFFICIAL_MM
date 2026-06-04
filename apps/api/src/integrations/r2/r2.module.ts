import { Global, Module } from '@nestjs/common';
import { R2Client } from './clients/r2.client';
import { R2Adapter } from './adapters/r2.adapter';

/**
 * Cloudflare R2 object-storage module (replaces the former S3Module). Global
 * so the adapter is injectable wherever the old S3 integration was used
 * (files pipeline, tax PDFs, retention/integrity crons, health probe).
 */
@Global()
@Module({
  providers: [R2Client, R2Adapter],
  exports: [R2Client, R2Adapter],
})
export class R2Module {}
