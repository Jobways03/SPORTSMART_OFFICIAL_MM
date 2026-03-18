import { AppException } from './app.exception';

export class DomainException extends AppException {
  constructor(message: string, code = 'DOMAIN_ERROR') {
    super(message, code);
  }
}
