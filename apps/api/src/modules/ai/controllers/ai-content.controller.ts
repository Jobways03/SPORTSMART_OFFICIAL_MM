import {
  Controller, Post, Body, HttpCode, HttpStatus, Logger, UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { BadRequestAppException } from '../../../core/exceptions';
import { AnyAuthGuard } from '../../../core/guards';
import { GoogleGenerativeAI } from '@google/generative-ai';

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
const AI_RATE_LIMIT = { default: { limit: 10, ttl: 60_000 } };

@ApiTags('AI Content')
@Controller('ai')
@UseGuards(AnyAuthGuard)
export class AiContentController {
  private readonly logger = new Logger(AiContentController.name);
  private client: GoogleGenerativeAI | null = null;

  private getClient(): GoogleGenerativeAI {
    if (!this.client) {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) throw new BadRequestAppException('AI features are not configured. Set GEMINI_API_KEY in .env');
      this.client = new GoogleGenerativeAI(apiKey);
    }
    return this.client;
  }

  @Post('generate-product-content')
  @HttpCode(HttpStatus.OK)
  @Throttle(AI_RATE_LIMIT)
  async generateProductContent(
    @Body() body: { title: string; category?: string; brand?: string; shortDescription?: string },
  ) {
    // Before: this endpoint had no auth and no per-call cap, so anyone
    // could hit /api/v1/ai/generate-product-content and burn Gemini
    // quota indefinitely. Guard + throttle fix the DoS surface; input
    // length caps below block the prompt-injection-via-bulk-payload
    // variant (stuff a novel into `title` to hijack the prompt).
    const title = (body?.title ?? '').toString().trim();
    if (!title) throw new BadRequestAppException('Product title is required');
    if (title.length > MAX_TITLE_LEN) {
      throw new BadRequestAppException(
        `Title must be ${MAX_TITLE_LEN} characters or fewer`,
      );
    }
    const category = this.clip(body?.category, MAX_CATEGORY_LEN);
    const brand = this.clip(body?.brand, MAX_BRAND_LEN);
    const shortDescription = this.clip(body?.shortDescription, MAX_SHORT_DESC_LEN);

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

    try {
      const client = this.getClient();
      const model = client.getGenerativeModel({ model: 'gemini-2.0-flash' });
      const response = await model.generateContent(prompt);
      const result = response.response;

      let text = result.text() || '';
      // Strip markdown code fences if present
      text = text.replace(/^```json?\s*/i, '').replace(/```\s*$/, '').trim();

      const parsed = JSON.parse(text);

      return {
        success: true,
        message: 'Content generated',
        data: {
          description: parsed.description || '',
          slug: parsed.slug || '',
          metaTitle: parsed.metaTitle || '',
          metaDescription: parsed.metaDescription || '',
        },
      };
    } catch (err: any) {
      this.logger.error(
        `AI generation failed: ${err?.message ?? 'unknown error'}`,
      );
      if (err instanceof SyntaxError) {
        throw new BadRequestAppException('AI returned invalid content. Try again.');
      }
      // Surface a generic message to the client so Gemini internals
      // (model ids, retry counts, quota hints) don't leak out.
      throw new BadRequestAppException('AI generation failed. Please try again.');
    }
  }

  private clip(value: string | undefined, max: number): string {
    const s = (value ?? '').toString().trim();
    return s.length > max ? s.slice(0, max) : s;
  }
}
