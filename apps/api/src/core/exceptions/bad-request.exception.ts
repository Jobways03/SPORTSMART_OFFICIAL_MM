import { AppException } from './app.exception';

export class BadRequestAppException extends AppException {
  /**
   * @param message - human-readable detail
   * @param code    - stable error identifier. Defaults to `BAD_REQUEST`, which
   *                  the global exception filter maps to HTTP 400. Pass a more
   *                  specific code (e.g. `GATEWAY_AMOUNT_MISMATCH`) so call
   *                  sites and tests can branch on it; the filter still maps
   *                  unknown codes to 400 via the bad-request status fallback.
   */
  constructor(message = 'Bad request', code: string = 'BAD_REQUEST') {
    super(message, code);
  }
}
