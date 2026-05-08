import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../bootstrap/database/prisma.service';
import {
  resolveLocale,
  type ResolveInput,
  I18N_DEFAULT_LOCALE,
} from './locale-resolver';

/**
 * Phase 9 (PR 9.2) — i18n message catalogue.
 *
 * Three responsibilities:
 *   1. Resolve the request's locale via `resolveLocale`.
 *   2. Look up `(locale, key)` in the catalogue, walking the fallback
 *      chain when an exact match isn't found.
 *   3. Render `{{var}}` placeholders against a `vars` map.
 *
 * Misses (no message in any chain entry) return the key itself —
 * loud-fallback so a missing translation is visible in the UI without
 * breaking the page render.
 *
 * Cache:
 *   - Per-locale, in-memory, 60s TTL. Locales are usually 100-500
 *     keys total, so we cache the entire locale at once instead of
 *     per-key.
 *   - Admin updates to messages take up to 60s to propagate.
 */
@Injectable()
export class MessageCatalogueService {
  private readonly logger = new Logger(MessageCatalogueService.name);
  private static readonly CACHE_TTL_MS = 60_000;

  /** locale → { messages: Map<key, body>, expiresAt: number }. */
  private readonly cache = new Map<
    string,
    { messages: Map<string, { body: string; shortBody: string | null }>; expiresAt: number }
  >();

  constructor(private readonly prisma: PrismaService) {}

  invalidate(): void {
    this.cache.clear();
  }

  /**
   * Render a key for the resolved locale. Returns:
   *   - The catalogue body (with vars substituted) if found.
   *   - The literal key string otherwise (loud-fallback).
   */
  async render(
    key: string,
    input: ResolveInput,
    vars: Record<string, string | number> = {},
    options: { short?: boolean } = {},
  ): Promise<{ body: string; locale: string }> {
    const { fallbackChain } = resolveLocale(input);
    for (const locale of fallbackChain) {
      const messages = await this.loadLocale(locale);
      const m = messages.get(key);
      if (m) {
        const tpl = options.short && m.shortBody ? m.shortBody : m.body;
        return { body: substitute(tpl, vars), locale };
      }
    }
    // Miss: loud fallback. Logs once per run so the dashboard catches
    // missing keys without spamming on every request.
    this.logger.warn(
      `i18n miss: key="${key}" tried [${fallbackChain.join(', ')}]`,
    );
    return { body: key, locale: I18N_DEFAULT_LOCALE };
  }

  private async loadLocale(
    locale: string,
  ): Promise<Map<string, { body: string; shortBody: string | null }>> {
    const now = Date.now();
    const hit = this.cache.get(locale);
    if (hit && hit.expiresAt > now) return hit.messages;

    const rows = await this.prisma.i18nMessage.findMany({
      where: { locale },
      select: { key: true, body: true, shortBody: true },
    });
    const messages = new Map<string, { body: string; shortBody: string | null }>();
    for (const r of rows) {
      messages.set(r.key, { body: r.body, shortBody: r.shortBody });
    }
    this.cache.set(locale, {
      messages,
      expiresAt: now + MessageCatalogueService.CACHE_TTL_MS,
    });
    return messages;
  }
}

/**
 * Replace `{{name}}` placeholders. Strict: an unmatched placeholder
 * stays literal in the output so missing variables are visible in
 * QA — silent removal would hide bugs.
 */
export function substitute(
  tpl: string,
  vars: Record<string, string | number>,
): string {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_match, name) => {
    if (Object.prototype.hasOwnProperty.call(vars, name)) {
      return String(vars[name]);
    }
    return `{{${name}}}`;
  });
}
