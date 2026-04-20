import { IsNotEmpty, IsString } from 'class-validator';

export class FranchiseSettlementPayDto {
  @IsNotEmpty({ message: 'Payment reference is required' })
  @IsString({ message: 'Payment reference must be a string' })
  paymentReference: string;
}
