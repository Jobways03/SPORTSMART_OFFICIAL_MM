/**
 * Phase 3 (PR 3.3) — RefundSaga step / compensation shape.
 *
 * Persisted as JSONB on `refund_sagas.steps` and `.compensations`.
 * Keeping the shape narrow + versioned helps long-running sagas
 * survive a deployment that changes the executor.
 */

export type SagaStepStatus =
  | 'PENDING'
  | 'IN_PROGRESS'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'SKIPPED'
  | 'COMPENSATED';

export interface SagaStepRecord {
  /** Stable step name. Identifies the behaviour, not the human description. */
  name: string;
  status: SagaStepStatus;
  attempts: number;
  /** Captured opaque result of the step (gateway id, wallet tx id, etc.). */
  result?: unknown;
  error?: string;
  startedAt?: string; // ISO
  completedAt?: string; // ISO
}

export interface SagaCompensationRecord {
  name: string;
  /** The step name this compensation reverses. */
  reversesStep: string;
  status: SagaStepStatus;
  error?: string;
  startedAt?: string;
  completedAt?: string;
}

/**
 * Each forward step is a function that mutates the saga's accumulated
 * context and returns a SagaStepRecord. The compensation has the same
 * shape but uses the step's `result` to undo it.
 *
 * The executor calls steps in order. On failure of step N:
 *   - Mark step N as FAILED
 *   - For each previously-SUCCEEDED step in REVERSE order, run its
 *     compensation. Compensations are best-effort but persistent —
 *     they're recorded even when the underlying op was a no-op.
 *   - Move saga to COMPENSATING then FAILED.
 */
export interface SagaStep<TContext> {
  name: string;
  /** Execute the forward action. Throws on failure. */
  execute(context: TContext): Promise<{
    /** Persisted on the step record. Used by `compensate`. */
    result?: unknown;
    /** Optional partial-context update (merged with shallow assign). */
    contextUpdate?: Partial<TContext>;
  }>;
  /**
   * Undo the forward action when a later step fails. May be a no-op
   * (e.g. for an audit-log write — leaving the row is fine; we're not
   * trying to be 100% perfect about side-effect erasure). Receives the
   * same context that was passed to `execute`, plus the result the
   * step recorded on success.
   */
  compensate?(
    context: TContext,
    forwardResult: unknown,
  ): Promise<void>;
}
