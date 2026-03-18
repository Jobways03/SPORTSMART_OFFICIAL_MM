export abstract class ValueObjectBase<TProps> {
  protected constructor(protected readonly props: TProps) {}

  equals(other?: ValueObjectBase<TProps>): boolean {
    if (!other) return false;
    return JSON.stringify(this.props) === JSON.stringify(other.props);
  }
}
