import { AppException } from './app.exception';

export class ConflictAppException extends AppException {
  constructor(message = 'Conflict') {
    super(message, 'CONFLICT');
  }
}
