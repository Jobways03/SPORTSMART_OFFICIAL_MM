export class AppException extends Error {
  constructor(
    message: string,
    public readonly code: string = 'APP_ERROR',
  ) {
    super(message);
  }
}
