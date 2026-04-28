import { DomainException } from '@core/exceptions/domain.exception'; export class ReturnNotFoundException extends DomainException { constructor() { super('Return not found', 'RETURN_NOT_FOUND'); } }
