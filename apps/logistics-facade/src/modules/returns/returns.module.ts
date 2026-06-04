import { Module } from '@nestjs/common';
import { ReturnsController } from './presentation/controllers/returns.controller';
import { ReturnsService } from './application/services/returns.service';
import { ShipmentsModule } from '../shipments/shipments.module';

@Module({
  imports: [ShipmentsModule], // for DefaultCourierGatewayResolver
  controllers: [ReturnsController],
  providers: [ReturnsService],
  exports: [ReturnsService],
})
export class ReturnsModule {}
