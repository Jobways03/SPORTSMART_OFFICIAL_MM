import { Injectable } from '@nestjs/common';

@Injectable()
export class AdminControlTowerPublicFacade {
  async getOperationalReadModel(modelType: string, filters: Record<string, unknown>): Promise<unknown> {
    throw new Error('Not implemented');
  }

  async invokeOverrideAction(action: string, targetId: string, params: unknown): Promise<void> {
    throw new Error('Not implemented');
  }
}
