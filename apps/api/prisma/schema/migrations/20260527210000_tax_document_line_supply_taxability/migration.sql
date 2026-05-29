-- Phase 159y — GSTR-3B export audit #2.
-- Per-line supply classification so the GSTR-3B export can populate
-- §3.1(b) zero-rated / (c) nil-rated+exempt / (e) non-GST from real data
-- instead of hard-coding 0. The "SupplyTaxability" enum already exists.
-- Nullable: existing rows stay NULL and are treated as TAXABLE by the
-- aggregator, so historical reports don't change.

ALTER TABLE "tax_document_lines" ADD COLUMN "supply_taxability" "SupplyTaxability";
