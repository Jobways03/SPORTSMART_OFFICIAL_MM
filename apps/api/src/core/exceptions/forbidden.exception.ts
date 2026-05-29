import { AppException } from './app.exception';

export class ForbiddenAppException extends AppException {
  /**
   * @param message human-readable detail
   * @param code    stable error identifier. Defaults to `FORBIDDEN`.
   *                Pass a more specific code (e.g. `EMAIL_NOT_VERIFIED`)
   *                so the frontend can branch on it.
   */
  constructor(message = 'Forbidden', code: string = 'FORBIDDEN') {
    super(message, code);
  }
}
