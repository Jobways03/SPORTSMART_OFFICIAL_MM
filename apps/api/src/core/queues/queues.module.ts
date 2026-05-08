import { Module } from '@nestjs/common';
import { QueueService } from './queue.service';
import { AdminQueuesController } from './admin-queues.controller';

/**
 * Phase 6 (PR 6.4) — queue management module. Mounts the admin
 * controller and provides the QueueService. SLA + Risk modules are
 * @Global()-imported elsewhere so we don't re-declare them here.
 */
@Module({
  controllers: [AdminQueuesController],
  providers: [QueueService],
  exports: [QueueService],
})
export class QueuesModule {}
