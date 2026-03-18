export interface EventLogRepositoryPort {
  save(entry: {
    eventName: string;
    aggregate: string;
    aggregateId: string;
    payload: unknown;
    publishedAt: Date;
  }): Promise<void>;
  findByAggregate(aggregate: string, aggregateId: string): Promise<unknown[]>;
}

export const EVENT_LOG_REPOSITORY = Symbol('EVENT_LOG_REPOSITORY');
