import { Injectable, Logger } from '@nestjs/common';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { EnvService } from '../../../bootstrap/env/env.service';
import {
  AiGenerationInput,
  AiGenerationResult,
  AiProvider,
} from './ai-provider.interface';

/**
 * Gemini provider. Lazily initialises the SDK client so a missing API
 * key is reported by `isConfigured()` rather than crashing at boot.
 * Enforces the per-call timeout via Promise.race because the Gemini
 * SDK exposes no native AbortSignal hook.
 */
@Injectable()
export class GeminiAiProvider implements AiProvider {
  readonly name = 'gemini';
  private readonly logger = new Logger(GeminiAiProvider.name);
  private client: GoogleGenerativeAI | null = null;

  constructor(private readonly env: EnvService) {}

  isConfigured(): boolean {
    return !!this.env.getString('GEMINI_API_KEY', '');
  }

  async generate(input: AiGenerationInput): Promise<AiGenerationResult> {
    const apiKey = this.env.getString('GEMINI_API_KEY', '');
    if (!apiKey) {
      throw new Error('Gemini provider is not configured (GEMINI_API_KEY missing)');
    }
    if (!this.client) {
      this.client = new GoogleGenerativeAI(apiKey);
    }

    const modelName = this.env.getString('AI_GEMINI_MODEL', 'gemini-2.0-flash');
    const model = this.client.getGenerativeModel({ model: modelName });

    const startedAt = Date.now();
    const text = await raceWithTimeout(
      model.generateContent(input.prompt).then((r) => r.response.text() || ''),
      input.timeoutMs,
      `Gemini generateContent exceeded ${input.timeoutMs}ms timeout`,
    );

    return {
      text,
      providerName: this.name,
      durationMs: Date.now() - startedAt,
    };
  }
}

/**
 * Pure helper — race a promise against a timer. Rejects with a
 * descriptive error so the orchestrator can decide whether to retry
 * with the next provider. Co-located here rather than exported because
 * the same pattern lives inline in the Anthropic provider; both copies
 * are tiny enough that a shared util would be over-abstraction.
 */
function raceWithTimeout<T>(p: Promise<T>, timeoutMs: number, msg: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(msg)), timeoutMs);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
