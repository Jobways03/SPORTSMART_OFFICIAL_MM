import { Injectable } from '@nestjs/common';

@Injectable()
export class FranchisePublicFacade {
  async getMappedFranchiseForPincode(pincode: string): Promise<unknown> {
    throw new Error('Not implemented');
  }

  async computeFranchiseFeeApplicability(params: {
    pincode: string;
    orderValue: number;
  }): Promise<unknown> {
    throw new Error('Not implemented');
  }

  async getFranchisePartnerState(franchiseId: string): Promise<unknown> {
    throw new Error('Not implemented');
  }
}
