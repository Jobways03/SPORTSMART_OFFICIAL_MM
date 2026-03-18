import { DomainException } from '@core/exceptions/domain.exception';
export class SellerNotFoundException extends DomainException { constructor() { super('Seller not found', 'SELLER_NOT_FOUND'); } }
