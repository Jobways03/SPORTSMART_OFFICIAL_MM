import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { EnvService } from '../../../bootstrap/env/env.service';
import {
  AiGenerationInput,
  AiGenerationResult,
  AiProvider,
} from './ai-provider.interface';

/**
 * Anthropic Claude provider. Used as fallback when Gemini fails or
 * hits quota — both providers receive the same prompt and produce
 * roughly equivalent output for the product-content use case.
 *
 * The SDK supports per-request `signal` for cancellation, so the
 * timeout is enforced via AbortController without needing a manual
 * Promise.race wrapper.
 */
@Injectable()
export class AnthropicAiProvider implements AiProvider {
  readonly name = 'anthropic';
  private readonly logger = new Logger(AnthropicAiProvider.name);
  private client: Anthropic | null = null;

  constructor(private readonly env: EnvService) {}

  isConfigured(): boolean {
    return !!this.env.getString('ANTHROPIC_API_KEY', '');
  }

  async generate(input: AiGenerationInput): Promise<AiGenerationResult> {
    const apiKey = this.env.getString('ANTHROPIC_API_KEY', '');
    if (!apiKey) {
      throw new Error('Anthropic provider is not configured (ANTHROPIC_API_KEY missing)');
    }
    if (!this.client) {
      this.client = new Anthropic({ apiKey });
    }

    const modelName = this.env.getString(
      'AI_ANTHROPIC_MODEL',
      'claude-haiku-4-5-20251001',
    );

    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), input.timeoutMs);

    try {
      const response = await this.client.messages.create(
        {
          model: modelName,
          // Phase 249 (#18) — 2048 was tight for the requested 2-3 paragraph
          // HTML description + highlights + two SEO fields, so the model
          // truncated mid-JSON → opaque parse_error. 4096 matches the
          // Gemini-Flash budget and leaves headroom.
          max_tokens: 4096,
          messages: [{ role: 'user', content: input.prompt }],
        },
        { signal: controller.signal },
      );

      // Phase 249 (#18) — surface a max_tokens truncation as a clear
      // provider failure (→ orchestrator falls back / caller retries)
      // instead of a downstream "invalid JSON" the user can't act on.
      if (response.stop_reason === 'max_tokens') {
        throw new Error('Anthropic response truncated (max_tokens) — output incomplete');
      }

      // Concatenate any text blocks the model returns. Tool-use blocks
      // / thinking blocks aren't expected for product-content
      // generation, so we filter them out rather than crash on the
      // union type.
      const text = response.content
        .map((b) =>
          b.type === 'text' && typeof (b as { text?: string }).text === 'string'
            ? (b as { text: string }).text
            : '',
        )
        .join('');

      return {
        text,
        providerName: this.name,
        durationMs: Date.now() - startedAt,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
