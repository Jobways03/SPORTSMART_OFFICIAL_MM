export interface DomainEvent<TPayload = unknown> {
  eventName: string;
  aggregate: string;
  aggregateId: string;
  occurredAt: Date;
  payload: TPayload;
  // Phase 186 (#16) — distributed-trace correlation. Optional so existing
  // publishers compile unchanged; the outbox publisher populates them from
  // the stored row when present, and request middleware can seed them.
  correlationId?: string | null;
  causationId?: string | null;
}
