import { ConsoleLogger, Injectable } from '@nestjs/common';
import { RequestContextService } from './request-context';

/**
 * Phase 11 (2026-05-16) — auto-prefix log lines with the active
 * request id when one is bound to the AsyncLocalStorage context.
 *
 * The middleware writes the request id into RequestContextService
 * for the whole handler chain (including async services and
 * synchronously-published event handlers). The logger reads from
 * the same ALS and prefixes each line so per-request log slicing
 * works without every call site threading the id explicitly.
 *
 * Outside any request (boot, cron ticks, outbox worker), the
 * prefix is omitted and lines look identical to the pre-Phase-11
 * behaviour. We deliberately don't fabricate a "system" id —
 * absence of `req=...` is informative.
 */
@Injectable()
export class AppLoggerService extends ConsoleLogger {
  setContext(context: string) {
    super.setContext(context);
  }

  log(message: any, ...optionalParams: any[]): void {
    super.log(this.withRequestId(message), ...optionalParams);
  }

  warn(message: any, ...optionalParams: any[]): void {
    super.warn(this.withRequestId(message), ...optionalParams);
  }

  error(message: any, ...optionalParams: any[]): void {
    super.error(this.withRequestId(message), ...optionalParams);
  }

  debug(message: any, ...optionalParams: any[]): void {
    super.debug(this.withRequestId(message), ...optionalParams);
  }

  verbose(message: any, ...optionalParams: any[]): void {
    super.verbose(this.withRequestId(message), ...optionalParams);
  }

  /**
   * If we're inside a request, append the request id when the caller
   * hasn't already done so. Outside any request (cron / outbox /
   * boot), pass through unchanged.
   */
  private withRequestId(message: unknown): unknown {
    if (typeof message !== 'string') return message;
    const id = RequestContextService.requestId();
    if (!id) return message;
    if (message.includes('req=')) return message;
    return `${message} req=${id}`;
  }
}
