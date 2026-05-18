import { Module } from '@nestjs/common';
import { AiContentController } from './controllers/ai-content.controller';
import { AnyAuthGuard, SellerAuthGuard, AdminAuthGuard } from '../../core/guards';
import { GeminiAiProvider } from './providers/gemini.provider';
import { AnthropicAiProvider } from './providers/anthropic.provider';
import { AiOrchestratorService } from './services/ai-orchestrator.service';
import { AiQuotaService } from './services/ai-quota.service';

/**
 * Phase 7 (2026-05-16) — AI module wiring.
 *
 * Pre-Phase-7 this module only registered the controller and its
 * guards. The controller called the Gemini SDK directly with no
 * fallback, no timeout, and no per-tenant quota. The module now wires:
 *
 *   • GeminiAiProvider     — primary provider (existing)
 *   • AnthropicAiProvider  — fallback when Gemini fails / hits quota
 *   • AiOrchestratorService — chain-of-responsibility selector
 *   • AiQuotaService       — per-(subject, day) quota enforcement
 *
 * EnvService + PrismaService are pulled in via the global Env / Prisma
 * modules so we don't need to re-import them here.
 */
@Module({
  controllers: [AiContentController],
  providers: [
    AnyAuthGuard,
    SellerAuthGuard,
    AdminAuthGuard,
    GeminiAiProvider,
    AnthropicAiProvider,
    AiOrchestratorService,
    AiQuotaService,
  ],
})
export class AiModule {}
