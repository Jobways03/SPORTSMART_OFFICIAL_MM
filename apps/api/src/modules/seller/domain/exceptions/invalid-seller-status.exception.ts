import { DomainException } from '@core/exceptions/domain.exception';
export class InvalidSellerStatusException extends DomainException { constructor() { super('Invalid seller status transition', 'INVALID_SELLER_STATUS'); } }
