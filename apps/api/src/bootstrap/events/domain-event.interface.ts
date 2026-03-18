export interface DomainEvent<TPayload = unknown> {
  eventName: string;
  aggregate: string;
  aggregateId: string;
  occurredAt: Date;
  payload: TPayload;
}
