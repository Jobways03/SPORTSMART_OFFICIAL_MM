import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../bootstrap/database/prisma.service';

/**
 * Phase 6 (2026-05-16) — WhatsApp session-window + opt-out state.
 *
 * Single source of truth for the two policy questions Meta forces us
 * to answer on every outbound message:
 *
 *   1. Has this phone opted out? (replied STOP / UNSUBSCRIBE)
 *   2. Are we inside the 24-hour customer service window from the
 *      phone's last inbound message?
 *
 * Inside the window → free-form text is allowed.
 * Outside the window OR no prior inbound → only HSM templates.
 * Opted out → nothing is sent. Period.
 *
 * The service is intentionally side-effect free apart from DB writes
 * — no fetches to Meta, no email/SMS. It is safe to call from
 * webhooks and outbound senders alike.
 */

/** The 24-hour customer service window per Meta Cloud API. */
export const WHATSAPP_SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Keywords that mark an inbound message as an opt-out request. */
const OPT_OUT_KEYWORDS = new Set([
  'STOP',
  'STOPALL',
  'UNSUBSCRIBE',
  'CANCEL',
  'END',
  'QUIT',
  'OPT-OUT',
  'OPT OUT',
  'OPTOUT',
]);

/** Keywords that re-enable a previously opted-out phone. */
const OPT_IN_KEYWORDS = new Set([
  'START',
  'YES',
  'UNSTOP',
  'SUBSCRIBE',
  'OPT-IN',
  'OPT IN',
  'OPTIN',
]);

export interface SendabilityResult {
  /** May we send anything at all? */
  allowed: boolean;
  /** When allowed=false, the reason. */
  blockedReason?: 'OPTED_OUT' | 'NO_PHONE';
  /** Whether the phone is within the 24-hour customer service window. */
  insideWindow: boolean;
  /** Last inbound timestamp from this phone (if any). */
  lastInboundAt: Date | null;
}

@Injectable()
export class WhatsappSessionService {
  private readonly logger = new Logger(WhatsappSessionService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Normalise a phone number to E.164 digits-only form. Strips
   * the leading "+", spaces, dashes, and parentheses. We never reject
   * here — callers may pass already-cleaned numbers — but we also
   * never *add* a country code, which is the caller's responsibility.
   */
  static normalisePhone(phone: string): string {
    return (phone || '').replace(/[^\d]/g, '');
  }

  /**
   * Detect whether an inbound text is an opt-out signal. Compares
   * the trimmed, uppercased first 64 chars against the keyword set;
   * a leading "STOP please don't message me" still matches "STOP".
   */
  static isOptOutText(body: string | null | undefined): boolean {
    if (!body) return false;
    const normalised = body.trim().toUpperCase().slice(0, 64);
    if (!normalised) return false;
    // Exact-keyword match first (most common case).
    if (OPT_OUT_KEYWORDS.has(normalised)) return true;
    // First-word match — handles "STOP", "STOP ALL", "UNSUBSCRIBE NOW", etc.
    const firstWord = normalised.split(/\s+/)[0]!;
    return OPT_OUT_KEYWORDS.has(firstWord);
  }

  /** Detect re-subscription keywords on inbound text. */
  static isOptInText(body: string | null | undefined): boolean {
    if (!body) return false;
    const normalised = body.trim().toUpperCase().slice(0, 64);
    if (!normalised) return false;
    if (OPT_IN_KEYWORDS.has(normalised)) return true;
    const firstWord = normalised.split(/\s+/)[0]!;
    return OPT_IN_KEYWORDS.has(firstWord);
  }

  /**
   * Read-only sendability check for the outbound gate. Does NOT
   * create a session row — a brand-new phone with no prior inbound
   * is reported as `insideWindow=false`, which forces the caller to
   * send a template.
   */
  async checkSendability(phone: string): Promise<SendabilityResult> {
    const phoneE164 = WhatsappSessionService.normalisePhone(phone);
    if (!phoneE164) {
      return { allowed: false, blockedReason: 'NO_PHONE', insideWindow: false, lastInboundAt: null };
    }

    const session = await this.prisma.whatsappSession.findUnique({
      where: { phoneE164 },
      select: { lastInboundAt: true, optedOutAt: true },
    });

    if (session?.optedOutAt) {
      return {
        allowed: false,
        blockedReason: 'OPTED_OUT',
        insideWindow: false,
        lastInboundAt: session.lastInboundAt ?? null,
      };
    }

    const insideWindow =
      !!session?.lastInboundAt &&
      Date.now() - session.lastInboundAt.getTime() < WHATSAPP_SESSION_WINDOW_MS;

    return {
      allowed: true,
      insideWindow,
      lastInboundAt: session?.lastInboundAt ?? null,
    };
  }

  /**
   * Record an inbound message: bumps `lastInboundAt`, opens the 24h
   * window, and detects STOP / START keywords to flip opt-out state.
   * Returns whether this inbound triggered an opt-out (so the caller
   * can audit / notify).
   */
  async recordInbound(
    phone: string,
    body: string | null | undefined,
    receivedAt: Date,
  ): Promise<{ optedOut: boolean; optedIn: boolean }> {
    const phoneE164 = WhatsappSessionService.normalisePhone(phone);
    if (!phoneE164) return { optedOut: false, optedIn: false };

    const isStop = WhatsappSessionService.isOptOutText(body);
    const isStart = WhatsappSessionService.isOptInText(body);

    // Resolve opt-out state. STOP wins on tie (defensive default).
    const optedOutPatch = isStop
      ? { optedOutAt: receivedAt, optOutReason: 'USER_STOP' }
      : isStart
        ? { optedOutAt: null, optOutReason: null }
        : {};

    await this.prisma.whatsappSession.upsert({
      where: { phoneE164 },
      create: {
        phoneE164,
        lastInboundAt: receivedAt,
        ...optedOutPatch,
      },
      update: {
        lastInboundAt: receivedAt,
        ...optedOutPatch,
      },
    });

    if (isStop) {
      this.logger.warn(
        `WhatsApp opt-out recorded for phone ending …${phoneE164.slice(-4)} via STOP keyword`,
      );
    }
    if (isStart && !isStop) {
      this.logger.log(
        `WhatsApp opt-in restored for phone ending …${phoneE164.slice(-4)} via START keyword`,
      );
    }

    return { optedOut: isStop, optedIn: isStart && !isStop };
  }

  /**
   * Record that we sent an outbound message — for diagnostics only.
   * Never blocks the outbound; failure here is logged and swallowed
   * so the message itself still goes out.
   */
  async recordOutbound(phone: string, sentAt: Date = new Date()): Promise<void> {
    const phoneE164 = WhatsappSessionService.normalisePhone(phone);
    if (!phoneE164) return;
    try {
      await this.prisma.whatsappSession.upsert({
        where: { phoneE164 },
        create: { phoneE164, lastOutboundAt: sentAt },
        update: { lastOutboundAt: sentAt },
      });
    } catch (err) {
      this.logger.warn(
        `Failed to record WhatsApp outbound timestamp: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Manual opt-out flip, used by support/compliance flows when a user
   * opts out via a non-WhatsApp channel (e.g. email reply).
   */
  async manualOptOut(phone: string, reason: string): Promise<void> {
    const phoneE164 = WhatsappSessionService.normalisePhone(phone);
    if (!phoneE164) return;
    const now = new Date();
    await this.prisma.whatsappSession.upsert({
      where: { phoneE164 },
      create: {
        phoneE164,
        optedOutAt: now,
        optOutReason: reason,
      },
      update: {
        optedOutAt: now,
        optOutReason: reason,
      },
    });
  }
}
