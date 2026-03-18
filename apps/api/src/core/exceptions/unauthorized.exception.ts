import { AppException } from './app.exception';

export class UnauthorizedAppException extends AppException {
  constructor(message = 'Unauthorized') {
    super(message, 'UNAUTHORIZED');
  }
}
