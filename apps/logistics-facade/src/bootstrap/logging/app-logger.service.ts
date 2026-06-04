import { ConsoleLogger, Injectable } from '@nestjs/common';
import { RequestContextService } from './request-context';

/**
 * NestJS-compatible logger that auto-prefixes log lines with the
 * active request id (from RequestContextService). Same shape as
 * apps/api/src/bootstrap/logging/app-logger.service.ts — when the
 * facade adopts pino later, swap the parent class without touching
 * call sites.
 *
 * Outside any request (boot, crons, outbox workers), the prefix is
 * omitted. We deliberately do not fabricate a "system" id — its
 * absence is informative.
 */
@Injectable()
export class AppLoggerService extends ConsoleLogger {
  log(message: unknown, ...optionalParams: unknown[]): void {
    super.log(this.withRequestId(message) as string, ...(optionalParams as string[]));
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    super.warn(this.withRequestId(message) as string, ...(optionalParams as string[]));
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    super.error(this.withRequestId(message) as string, ...(optionalParams as string[]));
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    super.debug(this.withRequestId(message) as string, ...(optionalParams as string[]));
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    super.verbose(this.withRequestId(message) as string, ...(optionalParams as string[]));
  }

  private withRequestId(message: unknown): unknown {
    const requestId = RequestContextService.requestId();
    if (!requestId) return message;
    if (typeof message !== 'string') return message;
    if (message.includes('req=')) return message;
    return `[req=${requestId}] ${message}`;
  }
}
