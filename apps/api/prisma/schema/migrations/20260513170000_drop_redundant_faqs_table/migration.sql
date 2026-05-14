-- Drop the `faqs` table created in 20260513160000_add_faqs.
-- The content module already owns a `faq_entries` table with the same
-- shape + a full admin CRUD surface in content.controllers.ts. Two
-- parallel FAQ models would just create write-path ambiguity, so we
-- consolidate on the pre-existing FaqEntry.

DROP INDEX IF EXISTS "faqs_is_active_idx";
DROP INDEX IF EXISTS "faqs_category_display_order_idx";
DROP TABLE IF EXISTS "faqs";
