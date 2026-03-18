export class SellerApprovalRule { static canApprove(status: string): boolean { return status === 'SUBMITTED'; } }
