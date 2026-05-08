import { Global, Module } from '@nestjs/common';
import { RiskScoreCalculator } from './risk-score.calculator';
import { RiskScoreService } from './risk-score.service';

/**
 * Phase 6 (PR 6.3) — global risk-scoring module. Same shape as
 * SlaModule / GuardsModule: domain code injects the service, the
 * calculator stays a stateless helper.
 */
@Global()
@Module({
  providers: [RiskScoreCalculator, RiskScoreService],
  exports: [RiskScoreCalculator, RiskScoreService],
})
export class RiskModule {}
