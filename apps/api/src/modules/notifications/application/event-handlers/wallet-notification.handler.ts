import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { DomainEvent } from '../../../../bootstrap/events/domain-event.interface';
import { IdempotentHandler } from '../../../../bootstrap/events/outbox/idempotent-handler.decorator';
import { EventDeduplicationService } from '../../../../bootstrap/events/outbox/event-deduplication.service';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { NotificationsPublicFacade } from '../facades/notifications-public.facade';

interface WalletCreditedPayload {
  userId: string;
  amountInPaise: number;
  balanceAfterInPaise: number;
  description: string;
  walletTransactionId: string;
  type: string;
}

@Injectable()
export class WalletNotificationHandler {
  private readonly logger = new Logger(WalletNotificationHandler.name);

  constructor(
    private readonly notifications: NotificationsPublicFacade,
    private readonly prisma: PrismaService,
    // Phase 2 / M21-M32 — exposed (not private) so the
    // @IdempotentHandler decorator can read it. The decorator
    // consults EventDeduplicationService before invoking the
    // handler body, so an outbox-driven replay can't trigger a
    // duplicate email.
    protected readonly eventDedup: EventDeduplicationService,
  ) {}

  @OnEvent('wallet.credited')
  @IdempotentHandler()
  async onWalletCredited(event: DomainEvent<WalletCreditedPayload>) {
    const { userId, amountInPaise, balanceAfterInPaise, description, walletTransactionId } =
      event.payload;
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { firstName: true, lastName: true, email: true },
      });
      if (!user) {
        this.logger.warn(`wallet.credited for unknown user ${userId}`);
        return;
      }
      await this.notifications.notifyFromTemplate({
        eventClass: 'wallet',
        templateKey: 'wallet.credited.email',
        recipientId: userId,
        eventId: walletTransactionId,
        vars: {
          customerName: `${user.firstName} ${user.lastName}`.trim(),
          amount: (amountInPaise / 100).toFixed(2),
          balanceAfter: (balanceAfterInPaise / 100).toFixed(2),
          description,
          preferencesUrl: process.env.STOREFRONT_URL
            ? `${process.env.STOREFRONT_URL}/account/notifications`
            : '/account/notifications',
        },
      });
    } catch (err) {
      this.logger.error(
        `Failed to send wallet.credited notification for user ${userId}: ${(err as Error).message}`,
      );
    }
  }
}
