import { Module } from '@nestjs/common';
import { CodRemittanceController } from './presentation/controllers/cod-remittance.controller';
import { CodRemittanceService } from './application/services/cod-remittance.service';
import { PullRemittanceCron } from './application/crons/pull-remittance.cron';
import { ShipmentsModule } from '../shipments/shipments.module';

@Module({
  imports: [ShipmentsModule],
  controllers: [CodRemittanceController],
  providers: [CodRemittanceService, PullRemittanceCron],
  exports: [CodRemittanceService],
})
export class CodRemittanceModule {}
