import { Public } from '@core/decorators';
import { Body, Controller, Headers, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { timingSafeEqual } from 'node:crypto';
import {
  BadRequestAppException,
  ForbiddenAppException,
} from '../../../../core/exceptions';
import { NotificationsPublicFacade } from '../../application/facades/notifications-public.facade';

/**
 * Phase 185 (#5) — carrier delivery-receipt (DLR) webhook.
 *
 * Email (SendGrid), WhatsApp (Meta) and SMS (MSG91/Twilio DLR) all POST a
 * delivery confirmation referencing the provider message id we stored on
 * the SENT log row. This endpoint flips that row SENT → DELIVERED.
 *
 * The body is typed loosely (`Record<string, unknown>`) ON PURPOSE: each
 * carrier sends its own payload shape with many extra fields, and the
 * global ValidationPipe (`forbidNonWhitelisted`) would 400 a strict DTO.
 * We extract + validate the handful of fields we need manually, accepting
 * the common per-carrier field aliases for the message id.
 *
 * It is NOT admin-authenticated — a carrier can't hold an admin token — so
 * it is gated by a shared secret (`NOTIFICATION_DELIVERY_RECEIPT_SECRET`)
 * compared in constant time, and fails CLOSED when the secret is unset.
 */
@ApiTags('Notifications — Webhooks')
@Public()
@Controller('webhooks/notifications')
@Throttle({ default: { limit: 1200, ttl: 60_000 } })
export class NotificationDeliveryReceiptController {
  constructor(private readonly notifications: NotificationsPublicFacade) {}

  @Post('delivery-receipt')
  async receipt(
    @Headers('x-delivery-receipt-secret') secret: string | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    this.assertSecret(secret);

    // Canonical id first, then common carrier aliases (Twilio MessageSid,
    // MSG91 requestId, Meta message id).
    const providerMessageId =
      this.str(body.providerMessageId) ??
      this.str(body.MessageSid) ??
      this.str(body.requestId) ??
      this.str(body.messageId) ??
      this.str(body.id);
    if (!providerMessageId) {
      throw new BadRequestAppException('providerMessageId (or a carrier alias) is required');
    }

    // Status alias: Twilio MessageStatus / generic status. Only a
    // delivered-class status advances state.
    const status = (this.str(body.status) ?? this.str(body.MessageStatus) ?? 'DELIVERED').toUpperCase();
    const isDelivered = status === 'DELIVERED' || status === 'DELIVRD';
    if (!isDelivered) {
      return { success: true, message: 'Receipt acknowledged (no-op)', data: { updated: 0 } };
    }

    const rawWhen = this.str(body.deliveredAt) ?? this.str(body.timestamp);
    const deliveredAt = rawWhen ? new Date(rawWhen) : new Date();
    if (Number.isNaN(deliveredAt.getTime())) {
      throw new BadRequestAppException('deliveredAt is not a valid date');
    }

    const updated = await this.notifications.recordDeliveryReceipt(
      providerMessageId,
      deliveredAt,
    );
    return {
      success: true,
      message: updated > 0 ? 'Delivery recorded' : 'No matching SENT notification',
      data: { updated },
    };
  }

  private str(v: unknown): string | undefined {
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number') return String(v);
    return undefined;
  }

  private assertSecret(provided: string | undefined): void {
    const expected = process.env.NOTIFICATION_DELIVERY_RECEIPT_SECRET ?? '';
    // Fail closed: no configured secret → reject (never silently open).
    if (!expected) {
      throw new ForbiddenAppException('Delivery-receipt webhook not configured');
    }
    const a = Buffer.from(provided ?? '');
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new ForbiddenAppException('Invalid delivery-receipt secret');
    }
  }
}
