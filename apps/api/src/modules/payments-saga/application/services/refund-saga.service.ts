import { Injectable, Logger } from '@nestjs/common';
import type { RefundSourceType } from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EnvService } from '../../../../bootstrap/env/env.service';
import {
  SagaCompensationRecord,
  SagaStep,
  SagaStepRecord,
} from '../../domain/saga-step.types';

export interface RefundSagaInput<TContext> {
  refundType: RefundSourceType;
  sourceId: string;
  customerId: string;
  amountInPaise: number;
  /** Initial context passed to every forward step. */
  context: TContext;
  steps: SagaStep<TContext>[];
  /**
   * Phase 96 (2026-05-23) — Phase 99 audit Gap #11 / Gap #15 closure.
   *
   * Idempotency key for the saga row. When provided, the executor
   * uses an upsert keyed on (idempotencyKey) so two concurrent
   * callers for the same instruction collapse to a single row. Pass
   * the RefundInstruction.idempotencyKey through to thread the chain.
   */
  idempotencyKey?: string;
  instructionId?: string;
}

export interface RefundSagaResult<TContext> {
  sagaId: string;
  status: 'COMPLETED' | 'FAILED';
  finalContext: TContext;
  failureReason?: string;
}

/**
 * Phase 3 (PR 3.3) — Refund SAGA executor.
 *
 * Drives a list of compensable steps to a terminal state (COMPLETED or
 * FAILED). Persists per-step state on `refund_sagas.steps` so a crash
 * mid-saga is recoverable: a future PR will add a "stuck-saga sweep"
 * that picks up sagas in IN_PROGRESS for too long and resumes them
 * from the last SUCCEEDED step.
 *
 * For now the executor runs sagas in-process synchronously — the
 * caller awaits the whole chain. That keeps the model simple while
 * we land the schema + the dispute / return refactors. PR 3.5+ will
 * add background recovery for sagas that crashed mid-flight.
 *
 * Behaviour at flag-OFF: `run()` short-circuits and runs the steps
 * directly without saga persistence. Existing call sites that shouldn't
 * activate the saga yet stay on legacy behaviour.
 */
@Injectable()
export class RefundSagaService {
  private readonly logger = new Logger(RefundSagaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
  ) {}

  async run<TContext>(
    input: RefundSagaInput<TContext>,
  ): Promise<RefundSagaResult<TContext>> {
    if (!this.enabled()) {
      return this.runWithoutSaga(input);
    }

    // Phase 96 (2026-05-23) — Phase 99 audit Gap #11 / #15 closure.
    // Idempotency-keyed lookup: if a saga for this instruction already
    // exists in a terminal state, return its outcome; if it's
    // in-flight, refuse to spawn a parallel run (the original caller
    // will finish, and the stuck-sweep cron handles crashes).
    if (input.idempotencyKey) {
      const existing = await this.prisma.refundSaga.findUnique({
        where: { idempotencyKey: input.idempotencyKey } as any,
      });
      if (existing) {
        if (existing.status === 'COMPLETED') {
          this.logger.log(
            `Refund saga ${existing.id} already COMPLETED for idempotencyKey=${input.idempotencyKey}; returning cached outcome`,
          );
          return {
            sagaId: existing.id,
            status: 'COMPLETED',
            finalContext: input.context,
          };
        }
        const existingStatusStr = String(existing.status);
        if (
          existingStatusStr === 'FAILED' ||
          existingStatusStr === 'COMPENSATED' ||
          existingStatusStr === 'COMPENSATION_FAILED'
        ) {
          this.logger.warn(
            `Refund saga ${existing.id} already terminal (${existing.status}) for idempotencyKey=${input.idempotencyKey}; returning cached outcome`,
          );
          return {
            sagaId: existing.id,
            status: 'FAILED',
            finalContext: input.context,
            failureReason: existing.failureReason ?? undefined,
          };
        }
        // STARTED / IN_PROGRESS / COMPENSATING — another caller is
        // already driving the saga. Refuse to spawn a parallel run.
        throw new Error(
          `Refund saga already in-flight for idempotencyKey=${input.idempotencyKey} (sagaId=${existing.id}, status=${existing.status})`,
        );
      }
    }

    // 1. Open the saga row in STARTED with PENDING step records.
    const saga = await this.prisma.refundSaga.create({
      data: {
        refundType: input.refundType,
        sourceId: input.sourceId,
        customerId: input.customerId,
        amountInPaise: BigInt(input.amountInPaise),
        status: 'STARTED',
        instructionId: input.instructionId ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        steps: input.steps.map<SagaStepRecord>((s) => ({
          name: s.name,
          status: 'PENDING',
          attempts: 0,
        })) as never,
      } as any,
    });

    let context = { ...input.context };
    const stepRecords: SagaStepRecord[] = input.steps.map((s) => ({
      name: s.name,
      status: 'PENDING',
      attempts: 0,
    }));

    // 2. Forward pass: execute each step in order. Persist after each.
    for (let i = 0; i < input.steps.length; i++) {
      const step = input.steps[i]!;

      stepRecords[i] = {
        ...stepRecords[i]!,
        status: 'IN_PROGRESS',
        startedAt: new Date().toISOString(),
      };

      // Follow-up #C10 — retry the step inline before declaring it
      // failed. Most stuck-saga escalations trace to transient PSP /
      // network blips. Per-step `maxAttempts` defaults to 1 (no
      // retry) so existing call sites preserve their behavior;
      // call sites that want retry opt in via the step descriptor.
      const maxAttempts = Math.max(1, step.maxAttempts ?? 1);
      const baseBackoffMs = Math.max(0, step.backoffMs ?? 500);
      let lastErr: unknown = null;
      let succeeded = false;
      let out: { result?: unknown; contextUpdate?: Partial<TContext> } | null = null;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        stepRecords[i] = {
          ...stepRecords[i]!,
          attempts: stepRecords[i]!.attempts + 1,
        };
        await this.persistSteps(saga.id, stepRecords, 'IN_PROGRESS');

        try {
          out = await step.execute(context);
          succeeded = true;
          break;
        } catch (err) {
          lastErr = err;
          const isLastAttempt = attempt === maxAttempts;
          const transient = step.isTransientError
            ? step.isTransientError(err)
            : true;
          // Stop retrying on the first non-transient error (e.g. 4xx
          // validation): the result is deterministic and waiting won't
          // change it. Also stop on the last attempt to avoid an extra
          // sleep before failing.
          if (!transient || isLastAttempt) {
            break;
          }
          this.logger.warn(
            `Saga ${saga.id} step "${step.name}" attempt ${attempt}/${maxAttempts} failed (transient): ${
              (err as Error).message ?? String(err)
            } — retrying`,
          );
          // Exponential backoff: 500ms, 1s, 2s, …
          const backoffMs = baseBackoffMs * Math.pow(2, attempt - 1);
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
        }
      }

      if (succeeded && out) {
        if (out.contextUpdate) {
          context = { ...context, ...out.contextUpdate };
        }
        stepRecords[i] = {
          ...stepRecords[i]!,
          status: 'SUCCEEDED',
          result: out.result,
          completedAt: new Date().toISOString(),
        };
        await this.persistSteps(saga.id, stepRecords, 'IN_PROGRESS');
      } else {
        const message = (lastErr as Error)?.message ?? String(lastErr);
        stepRecords[i] = {
          ...stepRecords[i]!,
          status: 'FAILED',
          error: message,
          completedAt: new Date().toISOString(),
        };
        // Mark remaining steps SKIPPED.
        for (let j = i + 1; j < stepRecords.length; j++) {
          stepRecords[j] = { ...stepRecords[j]!, status: 'SKIPPED' };
        }

        // Phase 96 (2026-05-23) — Phase 99 audit Gap #9 closure. Pre-
        // Phase-96 the saga went straight from IN_PROGRESS to FAILED;
        // the COMPENSATING enum value was dead. We now flip to
        // COMPENSATING while compensations run so observability
        // dashboards can see in-flight rollbacks vs. fully-resolved
        // FAILED ones.
        await this.prisma.refundSaga.update({
          where: { id: saga.id },
          data: {
            status: 'COMPENSATING',
            failureReason: message,
            steps: stepRecords as never,
          },
        });

        // 3. Compensate previously-succeeded steps in reverse order.
        const compensations = await this.runCompensations(
          input.steps.slice(0, i),
          stepRecords.slice(0, i),
          context,
        );

        // Phase 96 — Phase 99 audit Gap #18 closure. Distinguish
        // pure-forward failure (compensations clean) from
        // forward-AND-compensation failure (data drift; needs human).
        const anyCompFailed = compensations.some(
          (c: any) => c?.status === 'FAILED',
        );
        const finalStatus: 'FAILED' | 'COMPENSATED' | 'COMPENSATION_FAILED' =
          anyCompFailed
            ? 'COMPENSATION_FAILED'
            : compensations.length > 0
              ? 'COMPENSATED'
              : 'FAILED';

        await this.prisma.refundSaga.update({
          where: { id: saga.id },
          data: {
            status: finalStatus as any,
            failureReason: message,
            steps: stepRecords as never,
            compensations: compensations as never,
            completedAt: new Date(),
          },
        });

        if (anyCompFailed) {
          this.logger.error(
            `Refund saga ${saga.id} COMPENSATION_FAILED at step "${step.name}": ${message}. Human reconciliation required.`,
          );
        } else {
          this.logger.error(
            `Refund saga ${saga.id} ${finalStatus} at step "${step.name}": ${message}`,
          );
        }

        return {
          sagaId: saga.id,
          status: 'FAILED',
          finalContext: context,
          failureReason: message,
        };
      }
    }

    // 4. Forward pass succeeded.
    // Phase 96 (2026-05-23) — Phase 99 audit Gap #16 closure. Persist
    // the canonical walletTransactionId + gatewayRefundId on the saga
    // row so finance dashboards can search without joining the
    // instruction.
    const finalCtx = context as any;
    await this.prisma.refundSaga.update({
      where: { id: saga.id },
      data: {
        status: 'COMPLETED',
        walletTransactionId: finalCtx.walletTransactionId ?? null,
        gatewayRefundId: finalCtx.gatewayRefundId ?? null,
        steps: stepRecords as never,
        completedAt: new Date(),
      } as any,
    });

    return {
      sagaId: saga.id,
      status: 'COMPLETED',
      finalContext: context,
    };
  }

  // ─── Internals ────────────────────────────────────────────────────

  private enabled(): boolean {
    return this.env.getBoolean('REFUND_SAGA_ENABLED', false);
  }

  /**
   * Run the steps directly without saga persistence — flag-OFF path.
   * Compensations DO run on failure so the no-saga path still respects
   * the contract; we just don't persist a row.
   */
  private async runWithoutSaga<TContext>(
    input: RefundSagaInput<TContext>,
  ): Promise<RefundSagaResult<TContext>> {
    let context = { ...input.context };
    const completed: { step: SagaStep<TContext>; result: unknown }[] = [];
    for (const step of input.steps) {
      try {
        const out = await step.execute(context);
        if (out.contextUpdate) {
          context = { ...context, ...out.contextUpdate };
        }
        completed.push({ step, result: out.result });
      } catch (err) {
        const message = (err as Error).message ?? String(err);
        // Compensate in reverse.
        for (const done of completed.reverse()) {
          if (!done.step.compensate) continue;
          try {
            await done.step.compensate(context, done.result);
          } catch (compErr) {
            this.logger.warn(
              `Compensation for ${done.step.name} failed: ${(compErr as Error).message}`,
            );
          }
        }
        return {
          sagaId: '',
          status: 'FAILED',
          finalContext: context,
          failureReason: message,
        };
      }
    }
    return { sagaId: '', status: 'COMPLETED', finalContext: context };
  }

  private async persistSteps(
    sagaId: string,
    steps: SagaStepRecord[],
    status: 'STARTED' | 'IN_PROGRESS' | 'COMPENSATING' | 'COMPLETED' | 'FAILED',
  ): Promise<void> {
    await this.prisma.refundSaga.update({
      where: { id: sagaId },
      data: { status, steps: steps as never },
    });
  }

  private async runCompensations<TContext>(
    forwardSteps: SagaStep<TContext>[],
    forwardRecords: SagaStepRecord[],
    context: TContext,
  ): Promise<SagaCompensationRecord[]> {
    const compensations: SagaCompensationRecord[] = [];
    for (let i = forwardSteps.length - 1; i >= 0; i--) {
      const step = forwardSteps[i]!;

      const record = forwardRecords[i]!;

      // Skip compensation if the forward step didn't succeed (nothing to undo).
      if (record.status !== 'SUCCEEDED') continue;
      if (!step.compensate) {
        // Step is non-compensable. Record it explicitly so the saga
        // history shows we considered it.
        compensations.push({
          name: `${step.name}.compensation`,
          reversesStep: step.name,
          status: 'SKIPPED',
        });
        continue;
      }
      const startedAt = new Date().toISOString();
      try {
        await step.compensate(context, record.result);
        compensations.push({
          name: `${step.name}.compensation`,
          reversesStep: step.name,
          status: 'COMPENSATED',
          startedAt,
          completedAt: new Date().toISOString(),
        });
      } catch (err) {
        const message = (err as Error).message ?? String(err);
        // A failed compensation is logged but does NOT abort the
        // remaining compensations. Surfacing this to ops is the
        // right move (manual repair + audit trail) — the saga is
        // already in a failed state.
        this.logger.error(
          `Compensation failed for ${step.name}: ${message}`,
        );
        compensations.push({
          name: `${step.name}.compensation`,
          reversesStep: step.name,
          status: 'FAILED',
          error: message,
          startedAt,
          completedAt: new Date().toISOString(),
        });
      }
    }
    return compensations;
  }
}
