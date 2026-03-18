import { DomainException } from '@core/exceptions/domain.exception'; export class FileNotFoundException extends DomainException { constructor() { super('File not found', 'FILE_NOT_FOUND'); } }
