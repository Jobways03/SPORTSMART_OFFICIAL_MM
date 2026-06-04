import { Module } from '@nestjs/common';
import { QcController } from './presentation/controllers/qc.controller';
import { QcService } from './application/services/qc.service';

@Module({
  controllers: [QcController],
  providers: [QcService],
  exports: [QcService],
})
export class QcModule {}
