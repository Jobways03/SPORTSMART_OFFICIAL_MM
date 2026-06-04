import { Module } from '@nestjs/common';
import { NdrController } from './presentation/controllers/ndr.controller';
import { NdrService } from './application/services/ndr.service';
import { ShipmentsModule } from '../shipments/shipments.module';

@Module({
  imports: [ShipmentsModule],
  controllers: [NdrController],
  providers: [NdrService],
  exports: [NdrService],
})
export class NdrModule {}
