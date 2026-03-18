export interface UseCase<TInput = void, TOutput = void> {
  execute(input: TInput): Promise<TOutput>;
}
