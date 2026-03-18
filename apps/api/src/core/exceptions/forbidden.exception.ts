import { AppException } from './app.exception';

export class ForbiddenAppException extends AppException {
  constructor(message = 'Forbidden') {
    super(message, 'FORBIDDEN');
  }
}
