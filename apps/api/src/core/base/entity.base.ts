export abstract class EntityBase<TId = string> {
  constructor(public readonly id: TId) {}
}
