/**
 * Phase 7 (2026-05-16) — provider-agnostic interface for AI generation.
 *
 * Implementations live alongside this file (gemini.provider.ts,
 * anthropic.provider.ts). The strategy is selected at runtime via
 * `AI_PROVIDER_ORDER` env; when the primary throws or returns a
 * retryable failure, the orchestrator falls through to the next
 * provider in the list. This closes the single-provider-lock-in
 * gap from the §7.1 audit.
 */

export interface AiGenerationInput {
  /** Final prompt string, already templated. */
  prompt: string;
  /** Per-call timeout in ms. Provider must enforce. */
  timeoutMs: number;
}

export interface AiGenerationResult {
  /** Raw model output (string). */
  text: string;
  /** Which provider produced this result. */
  providerName: string;
  /** Wall-clock duration in ms. */
  durationMs: number;
}

/**
 * Implementations should:
 *   • Return `null` from `isConfigured()` when their API key is unset
 *     — the orchestrator skips unconfigured providers without raising.
 *   • Throw on any error. The orchestrator catches and tries the next
 *     provider. If every provider throws, the orchestrator re-throws
 *     the last error.
 *   • Respect `timeoutMs` strictly. Use AbortSignal.timeout when the
 *     underlying SDK supports it; otherwise wrap with Promise.race.
 */
export interface AiProvider {
  readonly name: string;
  isConfigured(): boolean;
  generate(input: AiGenerationInput): Promise<AiGenerationResult>;
}

export const AI_PROVIDERS = Symbol('AI_PROVIDERS');
