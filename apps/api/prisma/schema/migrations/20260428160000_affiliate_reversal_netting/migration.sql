
-- AlterTable
ALTER TABLE "affiliate_commissions" ADD COLUMN     "reversal_netted_in_payout_request_id" TEXT;

-- AlterTable
ALTER TABLE "affiliate_payout_requests" ADD COLUMN     "reversal_debit" DECIMAL(12,2) NOT NULL DEFAULT 0;

