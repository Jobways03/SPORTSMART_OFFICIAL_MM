import { Injectable, Logger, NotImplementedException } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { RedisService } from '../../../../bootstrap/cache/redis.service';
import { verifySignature } from '../../../../core/webhooks/webhook-signer';

/**
 * Central inbound-webhook handler. Every partner's tracking-webhook
 * route (mounted at `/webhooks/:partner`) calls into this service
 * after the controller extracts the body + signature.
 *
 * The full flow (M1):
 *   1. Lookup the partner's signing secret (PartnerWebhookSecret table
 *      — lands with the first adapter that needs it).
 *   2. Call `verifySignature(rawBody, header, secret, 300s)`. Reject
 *      with 401 on failure but STILL persist a WebhookEvent row with
 *      signatureValid=false for forensics.
 *   3. Compute a dedupe key from the partner-specific payload shape
 *      (most are `<event-id>:<awb>`) and SET NX on Redis with a 24h
 *      TTL. SET-NX miss = idempotent replay = return 200 (or 202)
 *      with the cached response.
 *   4. INSERT WebhookEvent row (unique on dedupKey guards a race
 *      between Redis and Postgres failover).
 *   5. Dispatch to the partner's mapper which translates raw payload
 *      to a domain event (`tracking.event.received`, `ndr.received`,
 *      `cod.remittance.received`) — published via EventBusService.
 *   6. Return 202 Accepted (the dispatcher works async via event
 *      handlers).
 *
 * M0 stub — only the verifier helper is wired in so callers see the
 * intended seam.
 */
@Injectable()
export class PartnerWebhookService {
  private readonly logger = new Logger(PartnerWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async ingest(
    _partner: string,
    _rawBody: string,
    _signatureHeader: string,
  ): Promise<{ status: 'accepted' | 'replayed' | 'rejected'; eventId: string | null }> {
    void this.prisma;
    void this.redis;
    void verifySignature;
    void this.logger;
    throw new NotImplementedException('Stub — implement in M1');
  }
}
