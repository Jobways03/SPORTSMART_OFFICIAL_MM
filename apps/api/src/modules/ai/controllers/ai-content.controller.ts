import {
  Controller, Post, Body, HttpCode, HttpStatus, Logger,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { BadRequestAppException } from '../../../core/exceptions';
import { GoogleGenerativeAI } from '@google/generative-ai';

@ApiTags('AI Content')
@Controller('ai')
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
  async generateProductContent(
    @Body() body: { title: string; category?: string; brand?: string; shortDescription?: string },
  ) {
    const { title, category, brand, shortDescription } = body;
    if (!title?.trim()) throw new BadRequestAppException('Product title is required');

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
      this.logger.error('AI generation failed', err?.message);
      if (err instanceof SyntaxError) {
        throw new BadRequestAppException('AI returned invalid content. Try again.');
      }
      throw new BadRequestAppException(err?.message || 'AI generation failed');
    }
  }
}
