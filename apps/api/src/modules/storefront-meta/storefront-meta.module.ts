import { Module } from '@nestjs/common';
import { StorefrontMetaController } from './storefront-meta.controller';
import { StorefrontMetaService } from './storefront-meta.service';

@Module({
  controllers: [StorefrontMetaController],
  providers: [StorefrontMetaService],
  exports: [StorefrontMetaService],
})
export class StorefrontMetaModule {}
