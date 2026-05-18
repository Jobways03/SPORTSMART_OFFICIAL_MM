import {
  Controller, Post, Body, HttpCode, HttpStatus, Logger, OnModuleInit, UseGuards, Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { BadRequestAppException } from '../../../core/exceptions';
import { AnyAuthGuard } from '../../../core/guards';
import {
  CounterHandle,
  HistogramHandle,
  MetricsRegistry,
} from '../../../core/metrics/metrics.registry';
import { AiOrchestratorService } from '../services/ai-orchestrator.service';
import { AiQuotaService } from '../services/ai-quota.service';

// Inputs go directly into a Gemini prompt; cap them so a malicious
// caller can't explode token usage (which costs money) or try prompt
// injection via a megabyte of instructions inside a "title".
const MAX_TITLE_LEN = 200;
const MAX_CATEGORY_LEN = 100;
const MAX_BRAND_LEN = 100;
const MAX_SHORT_DESC_LEN = 500;

// Conservative per-minute cap on AI calls per caller. Gemini free tier
// allows 15 req/min; paid tier is higher — but we want a per-user cap
// well below that so one seller can't drain the whole org's budget.
// The per-IP rate limit below is the first line of defence; the
// per-tenant daily quota in AiQuotaService is the second.
const AI_RATE_LIMIT = { default: { limit: 10, ttl: 60_000 } };

@ApiTags('AI Content')
@Controller('ai')
@UseGuards(AnyAuthGuard)
export class AiContentController implements OnModuleInit {
  private readonly logger = new Logger(AiContentController.name);

  // Story 7.2 — observability for AI usage. Registered once at boot;
  // `outcome` label split surfaces success vs. each failure mode so
  // ops can tell at a glance whether AI providers are the bottleneck,
  // our input validation, or quota exhaustion.
  private requestCounter!: CounterHandle;
  private durationHist!: HistogramHandle;

  constructor(
    private readonly metrics: MetricsRegistry,
    // Phase 7 (2026-05-16) — provider-agnostic orchestrator with
    // Gemini→Anthropic fallback + per-call timeout. Pre-Phase-7 this
    // controller wrapped the Gemini SDK directly, so a Gemini outage
    // = AI feature down + a hung request blocked the endpoint.
    private readonly orchestrator: AiOrchestratorService,
    // Per-tenant daily quota tracking. Throttler is per-IP / global;
    // quota is per-(subject, day) so a single seller cannot drain
    // the org budget by spreading across many IPs.
    private readonly quota: AiQuotaService,
  ) {}

  onModuleInit(): void {
    this.requestCounter = this.metrics.counter(
      'ai_generation_requests_total',
      'AI content-generation calls split by outcome (success | parse_error | provider_error | validation_error | quota_exhausted | not_configured).',
    );
    this.durationHist = this.metrics.histogram(
      'ai_generation_duration_ms',
      'Wall-clock duration of AI content-generation calls. ' +
        'Includes the full provider round-trip + our JSON-parsing step.',
      // Gemini Flash / Claude Haiku typically respond in 1–5s; allow
      // headroom for slower outliers so the bucket distribution stays
      // useful and the timeout (default 20s) is visible.
      [100, 250, 500, 1000, 2000, 5000, 10000, 20000, 30000],
    );
  }

  @Post('generate-product-content')
  @HttpCode(HttpStatus.OK)
  @Throttle(AI_RATE_LIMIT)
  async generateProductContent(
    @Req() req: Request & { authActorId?: string; user?: { type?: string } },
    @Body() body: { title: string; category?: string; brand?: string; shortDescription?: string },
  ) {
    // Before: this endpoint had no auth and no per-call cap, so anyone
    // could hit /api/v1/ai/generate-product-content and burn AI quota
    // indefinitely. Guard + throttle fix the DoS surface; input length
    // caps below block the prompt-injection-via-bulk-payload variant
    // (stuff a novel into `title` to hijack the prompt).
    const startedAt = Date.now();

    const subject = req.authActorId;
    const subjectType = req.user?.type ?? null;
    if (!subject) {
      // AnyAuthGuard set neither — should be impossible, but if a
      // future change removes that side-effect we want a loud error
      // rather than an unattributable AI call.
      this.requestCounter?.inc({ outcome: 'validation_error' });
      throw new BadRequestAppException('Cannot identify caller for quota tracking');
    }

    const title = (body?.title ?? '').toString().trim();
    if (!title) {
      this.requestCounter?.inc({ outcome: 'validation_error' });
      throw new BadRequestAppException('Product title is required');
    }
    if (title.length > MAX_TITLE_LEN) {
      this.requestCounter?.inc({ outcome: 'validation_error' });
      throw new BadRequestAppException(
        `Title must be ${MAX_TITLE_LEN} characters or fewer`,
      );
    }
    const category = this.clip(body?.category, MAX_CATEGORY_LEN);
    const brand = this.clip(body?.brand, MAX_BRAND_LEN);
    const shortDescription = this.clip(body?.shortDescription, MAX_SHORT_DESC_LEN);

    // Per-tenant daily quota check — refuse before spending provider
    // budget. Throws 409 ConflictAppException when the cap is reached.
    try {
      await this.quota.assertWithinQuota(subject);
    } catch (err) {
      this.requestCounter?.inc({ outcome: 'quota_exhausted' });
      this.durationHist?.observe(Date.now() - startedAt);
      throw err;
    }

    const prompt = `You are an expert e-commerce copywriter for a sports equipment marketplace called SportSmart.

Given this product info:
- Title: ${title}
${category ? `- Category: ${category}` : ''}
${brand ? `- Brand: ${brand}` : ''}
${shortDescription ? `- Short Description: ${shortDescription}` : ''}

Generate the following in JSON format:
{
  "description": "A compelling HTML product description (2-3 paragraphs with <p> tags, include a <h3>Product Highlights</h3> section with a <ul> bullet list of 4-6 key features. Use proper HTML tags. Make it engaging, informative, and SEO-friendly for a sports product.)",
  "slug": "url-friendly-slug-for-this-product",
  "metaTitle": "SEO meta title under 60 characters",
  "metaDescription": "SEO meta description under 155 characters, compelling and keyword-rich"
}

Return ONLY valid JSON, no markdown, no code fences, no explanation.`;

    let generation;
    try {
      generation = await this.orchestrator.generate(prompt);
    } catch (err: any) {
      this.logger.error(`AI generation failed: ${err?.message ?? 'unknown error'}`);
      this.durationHist?.observe(Date.now() - startedAt);
      // Orchestrator throws either "not configured" or "all providers
      // failed". Both surface as 400 with a generic message — internal
      // model ids / quota hints stay server-side.
      this.requestCounter?.inc({ outcome: 'provider_error' });
      throw new BadRequestAppException(
        err instanceof BadRequestAppException
          ? err.message
          : 'AI generation failed. Please try again.',
      );
    }

    // Record the call against the per-tenant quota — only on success
    // so failed calls don't burn the user's daily budget.
    await this.quota.recordCall(subject, subjectType, generation.providerName);

    let parsed: any;
    try {
      // Strip markdown code fences if a provider returns them anyway.
      const text = (generation.text || '')
        .replace(/^```json?\s*/i, '')
        .replace(/```\s*$/, '')
        .trim();
      parsed = JSON.parse(text);
    } catch {
      this.requestCounter?.inc({ outcome: 'parse_error' });
      this.durationHist?.observe(Date.now() - startedAt);
      throw new BadRequestAppException('AI returned invalid content. Try again.');
    }

    this.requestCounter?.inc({ outcome: 'success', provider: generation.providerName });
    this.durationHist?.observe(Date.now() - startedAt);

    return {
      success: true,
      message: 'Content generated',
      data: {
        description: parsed.description || '',
        slug: parsed.slug || '',
        metaTitle: parsed.metaTitle || '',
        metaDescription: parsed.metaDescription || '',
      },
      meta: {
        provider: generation.providerName,
        durationMs: generation.durationMs,
      },
    };
  }

  private clip(value: string | undefined, max: number): string {
    const s = (value ?? '').toString().trim();
    return s.length > max ? s.slice(0, max) : s;
  }
}
