import { Inject, Injectable } from '@nestjs/common';
import {
  RETURN_REPOSITORY,
  ReturnRepository,
} from '../../domain/repositories/return.repository.interface';

@Injectable()
export class ReturnsPublicFacade {
  constructor(
    @Inject(RETURN_REPOSITORY)
    private readonly returnRepo: ReturnRepository,
  ) {}

  async getReturnById(id: string): Promise<any | null> {
    return this.returnRepo.findByIdWithItems(id);
  }

  async getReturnsForSubOrder(subOrderId: string): Promise<any[]> {
    return this.returnRepo.findBySubOrderId(subOrderId);
  }
}
