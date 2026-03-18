export interface IntegrationEvent<TPayload = unknown> {
  eventName: string;
  source: string;
  occurredAt: Date;
  payload: TPayload;
}
