import { AppException } from './app.exception';

export class BadRequestAppException extends AppException {
  constructor(message = 'Bad request') {
    super(message, 'BAD_REQUEST');
  }
}
