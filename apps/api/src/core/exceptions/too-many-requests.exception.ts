import { AppException } from './app.exception';

/**
 * Phase 7 (PR 7.3) — 429-style rate-limit exception. Emitted by the
 * file-URL audit service when a (file, requester) pair exceeds the
 * issuance ceiling, and reusable by other rate-limited surfaces.
 */
export class TooManyRequestsAppException extends AppException {
  constructor(message = 'Too many requests') {
    super(message, 'TOO_MANY_REQUESTS');
  }
}
