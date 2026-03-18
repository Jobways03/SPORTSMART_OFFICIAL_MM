import { AppException } from './app.exception';

export class NotFoundAppException extends AppException {
  constructor(message = 'Resource not found') {
    super(message, 'NOT_FOUND');
  }
}
