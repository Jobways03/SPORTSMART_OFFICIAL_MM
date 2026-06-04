import { Module } from '@nestjs/common';
import { RtoController } from './presentation/controllers/rto.controller';
import { RtoService } from './application/services/rto.service';
import { ShipmentsModule } from '../shipments/shipments.module';

@Module({
  imports: [ShipmentsModule],
  controllers: [RtoController],
  providers: [RtoService],
  exports: [RtoService],
})
export class RtoModule {}
