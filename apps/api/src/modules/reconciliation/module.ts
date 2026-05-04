import { Module } from '@nestjs/common';
import { AdminAuthGuard } from '../../core/guards';
import { ReconciliationService } from './application/services/reconciliation.service';
import { AdminReconciliationController } from './presentation/controllers/admin-reconciliation.controller';

@Module({
  controllers: [AdminReconciliationController],
  providers: [AdminAuthGuard, ReconciliationService],
  exports: [ReconciliationService],
})
export class ReconciliationModule {}
