import { IsBoolean, IsIn, IsString } from 'class-validator';
import { ConsentService } from '../../application/services/consent.service';

/**
 * Body for POST /customer/consent.
 * `purpose` is validated against the static PURPOSES list on
 * ConsentService — any unknown value is rejected at the DTO boundary.
 */
export class SetConsentDto {
  @IsString()
  @IsIn(ConsentService.PURPOSES as unknown as string[], {
    message: `purpose must be one of: ${ConsentService.PURPOSES.join(', ')}`,
  })
  purpose!: string;

  @IsBoolean({ message: 'granted must be a boolean' })
  granted!: boolean;
}
