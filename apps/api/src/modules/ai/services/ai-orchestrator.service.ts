import { Injectable, Logger } from '@nestjs/common';
import { EnvService } from '../../../bootstrap/env/env.service';
import { BadRequestAppException } from '../../../core/exceptions';
import { GeminiAiProvider } from '../providers/gemini.provider';
import { AnthropicAiProvider } from '../providers/anthropic.provider';
import {
  AiGenerationResult,
  AiProvider,
} from '../providers/ai-provider.interface';

/**
 * Phase 7 (2026-05-16) — provider-agnostic AI orchestrator.
 *
 * Reads `AI_PROVIDER_ORDER` (default "gemini,anthropic") and tries
 * each provider in order. A provider that:
 *   • is not configured → skipped silently
 *   • throws → logged, fall through to next
 *   • returns text → returned immediately
 *
 * When every provider in the list fails the orchestrator re-throws
 * the last error so the caller still gets a useful message.
 *
 * The per-call timeout (`AI_REQUEST_TIMEOUT_MS`, default 20s) is
 * passed into each provider so a hung primary doesn't block the
 * fallback indefinitely.
 */
@Injectable()
export class AiOrchestratorService {
  private readonly logger = new Logger(AiOrchestratorService.name);

  constructor(
    private readonly env: EnvService,
    private readonly gemini: GeminiAiProvider,
    private readonly anthropic: AnthropicAiProvider,
  ) {}

  /**
   * Returns the ordered, configured providers from env. Unconfigured
   * providers are dropped so the orchestrator's main loop doesn't
   * have to special-case them. If the env order names a provider we
   * don't know about, we skip it with a warn — that way a typo in
   * the env doesn't bring down the AI surface.
   */
  private resolveProviderChain(): AiProvider[] {
    const orderEnv = this.env.getString('AI_PROVIDER_ORDER', 'gemini,anthropic');
    const names = orderEnv
      .split(',')
      .map((n) => n.trim().toLowerCase())
      .filter(Boolean);

    const registry: Record<string, AiProvider> = {
      gemini: this.gemini,
      anthropic: this.anthropic,
    };

    const chain: AiProvider[] = [];
    for (const name of names) {
      const provider = registry[name];
      if (!provider) {
        this.logger.warn(`AI_PROVIDER_ORDER mentions unknown provider "${name}" — skipped`);
        continue;
      }
      if (!provider.isConfigured()) continue;
      chain.push(provider);
    }
    return chain;
  }

  /**
   * Generate text via the configured provider chain. Per-call
   * timeout enforced inside each provider.
   */
  async generate(prompt: string): Promise<AiGenerationResult> {
    const chain = this.resolveProviderChain();
    if (chain.length === 0) {
      throw new BadRequestAppException(
        'AI features are not configured. Set GEMINI_API_KEY or ANTHROPIC_API_KEY in .env',
      );
    }

    const timeoutMs = this.env.getNumber('AI_REQUEST_TIMEOUT_MS', 20_000);

    let lastError: Error | null = null;
    for (const provider of chain) {
      try {
        return await provider.generate({ prompt, timeoutMs });
      } catch (err) {
        lastError = err as Error;
        this.logger.warn(
          `AI provider "${provider.name}" failed: ${lastError.message}`,
        );
        // Continue to the next provider in the chain.
        continue;
      }
    }

    // Every provider exhausted. Re-throw the last error wrapped so
    // controllers see a 400 with a generic message, not the raw
    // provider error (which can leak quota/model details).
    this.logger.error(
      `All AI providers failed. Last error: ${lastError?.message ?? 'unknown'}`,
    );
    throw new BadRequestAppException(
      'AI generation failed. Please try again later.',
    );
  }
}
