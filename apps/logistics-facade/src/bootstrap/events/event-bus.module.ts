import { Global, Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { EventBusService } from './event-bus.service';

@Global()
@Module({
  imports: [
    EventEmitterModule.forRoot({
      // wildcard:true is needed for the future @OnEvent('shipment.*')
      // listeners that BI / notification adapters will register. See
      // apps/api/src/bootstrap/events/events.module.ts for the same
      // reasoning — leaving it off causes wildcard listeners to fire
      // never, with no error.
      wildcard: true,
      delimiter: '.',
      maxListeners: 20,
      verboseMemoryLeak: true,
    }),
  ],
  providers: [EventBusService],
  exports: [EventBusService],
})
export class EventBusModule {}
