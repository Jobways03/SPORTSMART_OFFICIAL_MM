import { DomainException } from '@core/exceptions/domain.exception';

export class UserAlreadyExistsException extends DomainException {
  constructor() {
    super('User already exists', 'USER_ALREADY_EXISTS');
  }
}
