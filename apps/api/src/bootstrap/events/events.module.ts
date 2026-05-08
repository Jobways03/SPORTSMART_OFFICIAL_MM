import { Global, Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { EventBusService } from './event-bus.service';
import { OutboxPublisherService } from './outbox/outbox-publisher.service';
import { EventDeduplicationService } from './outbox/event-deduplication.service';

@Global()
@Module({
  imports: [
    EventEmitterModule.forRoot({
      // `wildcard: true` is required for the audit module's
      // @OnEvent('**') domain-event logger and the @OnEvent('admin.action.*')
      // admin-action handler. With the previous wildcard: false setting,
      // those listeners were registered under the literal strings "**" /
      // "admin.action.*" and never fired, so the EventLog audit table
      // was silently empty in production. Exact-name listeners keep
      // their exact-match semantics — wildcards are purely additive.
      wildcard: true,
      delimiter: '.',
      maxListeners: 20,
      verboseMemoryLeak: true,
    }),
  ],
  providers: [
    EventBusService,
    OutboxPublisherService,
    EventDeduplicationService,
  ],
  exports: [
    EventBusService,
    OutboxPublisherService,
    EventDeduplicationService,
  ],
})
export class EventsModule {}
