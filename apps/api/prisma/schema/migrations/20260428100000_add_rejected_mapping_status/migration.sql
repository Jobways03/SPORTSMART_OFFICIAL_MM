-- Add REJECTED to the MappingApprovalStatus enum so admins can reject
-- a franchise's catalog-mapping submission. The franchise then edits
-- the row and re-submits, flipping the status back to PENDING_APPROVAL
-- for re-review. Same enum is shared with seller_product_mappings —
-- adding a value is non-breaking; existing rows keep their values.
ALTER TYPE "MappingApprovalStatus" ADD VALUE IF NOT EXISTS 'REJECTED';
