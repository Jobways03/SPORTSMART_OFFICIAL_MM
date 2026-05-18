import { Module } from '@nestjs/common';
import { WhatsAppClient } from './clients/whatsapp.client';
import { WhatsAppAdapter } from './adapters/whatsapp.adapter';
import { WhatsappSessionService } from './services/whatsapp-session.service';
import { WhatsappWebhookController } from './controllers/whatsapp-webhook.controller';
import { PrismaModule } from '../../bootstrap/database/prisma.module';
import { EnvModule } from '../../bootstrap/env/env.module';

/**
 * Phase 6 (2026-05-16) — WhatsApp integration module.
 *
 * Wires three pieces:
 *   - `WhatsAppClient`           — Meta Cloud HTTP client with retry/HMAC.
 *   - `WhatsAppAdapter`          — high-level sender (text + template).
 *   - `WhatsappSessionService`   — 24h-window + opt-out policy.
 *   - `WhatsappWebhookController` — Meta inbound webhook receiver.
 *
 * The adapter consumes the session service to gate every outbound,
 * so any consumer (notifications, identity OTP, etc.) automatically
 * inherits opt-out + 24h-window enforcement.
 */
@Module({
  imports: [PrismaModule, EnvModule],
  controllers: [WhatsappWebhookController],
  providers: [WhatsAppClient, WhatsAppAdapter, WhatsappSessionService],
  exports: [WhatsAppClient, WhatsAppAdapter, WhatsappSessionService],
})
export class WhatsAppModule {}
