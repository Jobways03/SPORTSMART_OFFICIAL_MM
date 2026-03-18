export abstract class AggregateRoot {
  private domainEvents: unknown[] = [];

  protected addDomainEvent(event: unknown): void {
    this.domainEvents.push(event);
  }

  pullDomainEvents(): unknown[] {
    const events = [...this.domainEvents];
    this.domainEvents = [];
    return events;
  }
}
