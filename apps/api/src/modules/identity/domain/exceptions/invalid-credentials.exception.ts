import { DomainException } from '@core/exceptions/domain.exception';

export class InvalidCredentialsException extends DomainException {
  constructor() {
    super('Invalid credentials', 'INVALID_CREDENTIALS');
  }
}
