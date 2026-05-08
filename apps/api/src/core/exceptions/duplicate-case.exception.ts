import { AppException } from './app.exception';

/**
 * Thrown when a caller tries to create a return / dispute / ticket
 * that duplicates an existing active case (per the Phase 1.5 rules).
 *
 * The `code` is `DUPLICATE_CASE` so the global filter maps to the
 * `case-duplicate` problem-type. `duplicateOfId` is exposed to
 * service callers so they can include it in the `detail` message
 * (e.g. "An active return already exists: RET-2026-001234").
 */
export class DuplicateCaseException extends AppException {
  constructor(
    message: string,
    /**
     * Stable identifier of the existing active case the caller
     * collided with (DSP-..., RET-..., TKT-..., or the row id when no
     * caseNumber yet).
     */
    public readonly duplicateOfId: string,
    /**
     * Programmatic enum of which rule fired — drives the response
     * detail and the `case_duplicates.reason` audit column.
     */
    public readonly rule: string,
  ) {
    super(message, 'DUPLICATE_CASE');
  }
}
