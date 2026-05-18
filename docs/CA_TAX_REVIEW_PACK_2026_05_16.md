# SportSmart Marketplace — Tax & GST Review Pack for the Chartered Accountant

**Prepared on:** 2026-05-16
**Audience:** Our retained Chartered Accountant
**Purpose:** To give you a complete, plain-English picture of how SportSmart computes, records, and reports tax across every order; what documents we issue and what each document contains; how we handle returns, refunds and credit notes; how we store records; and where we would like your guidance before we go further. This document is meant to be read end-to-end before our meeting, so you arrive with a clear map of what we do and where the open questions are.

---

## 1. The shape of the marketplace and what that means for tax

SportSmart is an online sporting-goods marketplace based in India. Customers (called "users" in our system) place orders that may contain products from many different sellers in a single basket. Each customer order, which we call a master order, is split internally into one or more sub-orders — one sub-order for every seller whose product was in the basket. The sub-order is the unit at which all tax decisions are made, because each seller is the actual supplier of the goods that go on that part of the bill, and each seller may be a different legal entity with a different GSTIN, a different registration type, and a different place of business.

This split has three consequences that the CA should keep in mind throughout this document. First, a single customer order can produce two, three, or four separate tax invoices — one per seller. Second, two of those invoices for the same customer could be a Tax Invoice and a Bill of Supply at the same time, because one seller is regularly registered under GST while the other is on the composition scheme. Third, returns and credit notes always work at the sub-order level, never at the master-order level, because the goods being returned were supplied by exactly one seller, and the credit note must come from that seller's books, not from the platform's.

The platform itself, SportSmart, also acts as a supplier in two cases. First, when we sell our own-brand products — these go out under SportSmart's own GSTIN, not under a third-party seller's. Second, when a franchise partner is the supplier — franchise sales (point-of-sale and procurement) flow through the franchise's own GSTIN, which is registered separately. The product catalog and inventory live with the franchise, and SportSmart acts as the brand and platform layer. In both these cases the tax engine treats the supplier the same way it treats any other registered seller; the only difference is which GSTIN appears on the invoice.

---

## 2. What taxes we apply, and when each one applies

We charge three families of indirect tax on a typical order. Every product on the platform carries a Harmonised System of Nomenclature (HSN) code with an associated GST rate expressed in basis points (so 18 percent appears in our system as 1800 basis points). Every product also carries a taxability classification — most products are simply "taxable", but a small number are marked "nil-rated", "exempt", "non-GST", "zero-rated" or "out-of-scope", and our tax engine short-circuits the GST calculation to zero for any of these classes.

For taxable supplies, we apply either Central GST plus State GST, or Integrated GST, depending on whether the supply is intra-state or inter-state. We make this decision per sub-order, using the supplier's registered state (taken from the seller's primary GSTIN, the first two characters of which are the state code) and the place of supply (which for business-to-consumer orders is the customer's shipping state, and for business-to-business orders can be configured to either the shipping state or the buyer's GSTIN state — by default we use the shipping state, but the choice is administrator-controlled per our `tax_config.b2b_place_of_supply_source` setting). When supplier state equals place-of-supply state, we split the total GST evenly between CGST and SGST; otherwise we levy it entirely as IGST. The split is computed in such a way that the sum of CGST and SGST always equals the total tax for that line, even when the rate is odd — we derive SGST as "total tax minus CGST" so any single-paise rounding asymmetry always lands inside SGST rather than producing a one-paise gap.

We also apply Tax Collected at Source under Section 52 of the CGST Act. Marketplace operators are required to deduct 1 percent (100 basis points) on the net taxable value of supplies made through the platform to non-composition customers. Our engine splits this exactly the way it splits regular GST: 50 basis points to CGST plus 50 basis points to SGST for intra-state transactions, and a full 100 basis points to IGST for inter-state. Importantly, TCS is computed on the net taxable supply value after credit notes within the same period — if a customer returns part of an order in the same filing month as the original, the TCS for that month is computed on the net of (sale minus return). When returns happen in a later period than the sale, the credit-note reversal can push the net into negative territory; in that case we carry the excess forward into the next period rather than producing a negative TCS line, because the GST portal does not accept negative TCS in any single GSTR-8. We have a dedicated TCS settlement ledger that records the running balance per (seller, filing period).

Cess is supported in the engine, but the actual rate is taken from the HSN master row, not assumed. Most of our catalog does not attract cess, but for any category that does (such as certain tobacco-adjacent or luxury goods), the engine computes the cess on top of the taxable value, after GST, and surfaces it on a separate line on the invoice. We do not currently sell cess-attracting products, but the support is in place for future expansion.

We do not charge any other indirect taxes on a sale. We do not charge VAT on top of GST, we do not charge service tax (which has been subsumed into GST), and we do not separately bill anti-dumping or basic customs duty on the invoice, because all goods on the platform are domestic supply and any import duty has already been paid by the supplier before listing.

---

## 3. How the tax amount is actually computed

Pricing on SportSmart is captured by sellers in one of two modes per product line: inclusive or exclusive. Inclusive means the seller has set the price as the gross amount including all GST; exclusive means the seller has set the price as the taxable value, and our engine adds GST on top. Both modes are supported throughout the engine, but the math is different and worth describing carefully.

In exclusive mode, the math is straightforward. The taxable value is the gross line value minus any line-level discount. The GST is then `taxable × rate / 10000` (because the rate is in basis points). For a 1000-rupee product at 18 percent, taxable is 1000, GST is 180, and the line total is 1180. CGST and SGST are 90 each in an intra-state case, or the GST appears entirely as IGST of 180 in an inter-state case.

In inclusive mode, the gross line value already contains the GST, and we have to back the taxable value out. The formula is `taxable = floor(net × 10000 / (10000 + rate))`, where `net` is gross minus discount. For a 1180-rupee inclusive product at 18 percent, taxable becomes 1000 and tax becomes 180. The "floor" in that expression is deliberate — it ensures the recomputed taxable plus tax never exceeds the original inclusive amount even when the rate doesn't divide evenly. Rounding is then absorbed in the tax portion rather than the taxable portion.

All money in our system is stored as integer paise (so 1000 rupees is 100000 paise) using a 64-bit BigInt type, not as floating-point or as a Decimal type that would round at boundaries. This avoids the classic IEEE-754 drift problem where adding `0.1 + 0.2` does not give exactly `0.3`. Every step of the computation — taxable, CGST, SGST, IGST, cess, total tax, line total — happens in paise, and we only convert to rupees at the presentation boundary (the printed invoice and the PDF). This is something I think you would want to verify in person, because it is the single most important correctness property of the entire engine: there is no path through the code that converts to floating point and back.

After all line-level tax has been computed and aggregated, the document total comes out with a remainder in paise. By convention every printed Indian GST invoice rounds to the nearest rupee on the grand total and shows the rounding difference as a separate "Round Off" line. We implement this using a half-away-from-zero rounding rule: a paise remainder of 50 or more rounds up to the next rupee; less than 50 rounds down. The signed difference (positive or negative) appears on the invoice as the round-off line, and the customer-facing grand total is the rounded value. The unrounded amount is also kept on file in case there is ever a reconciliation dispute.

---

## 4. Which document we issue, and why

GST law requires that the right kind of document accompany every supply, and the choice depends on three things: the registration type of the supplier, the taxability of the items being supplied, and whether the recipient is a registered business or an end consumer. Our engine makes this decision through a single dedicated function, and the choice is deterministic given those three inputs.

For a regularly-registered seller supplying taxable items to any customer, we issue a **Tax Invoice**. This is the standard document that everyone expects to see — it shows the supplier's GSTIN, the recipient's details, line-level breakdown of taxable value, the CGST/SGST/IGST split, cess if applicable, the round-off, the grand total, and the amount in words.

For a seller registered under the composition scheme, or for any seller supplying only exempt or nil-rated items, we issue a **Bill of Supply** instead. The Bill of Supply has the same general shape but does not display CGST/SGST/IGST columns or totals — under composition, the supplier is not allowed to collect GST from the buyer, and under exempt or nil-rated supply, there is no GST to display. The footer carries the standard CBIC declaration that the document is a Bill of Supply and that no GST claim applies.

For a regularly-registered seller whose single order contains both taxable and exempt items, we issue an **Invoice-cum-Bill of Supply**. This is a hybrid document that covers both kinds of lines on one page, with GST shown on the taxable lines only. CBIC permits this format under Rule 46A specifically to avoid forcing customers to receive two separate documents for one order.

When a sub-order is QC-approved and a refund is owed back to the customer, the system issues a **Credit Note** under Section 34. The credit note references the original invoice number, lists only the items that are being credited (and only the portion of the original quantity that is being credited — partial returns are fully supported and produce a credit note covering only the returned portion), shows the reversal of taxable value and the reversal of CGST/SGST/IGST, and totals to a negative-direction adjustment that reduces the seller's outward-supply liability for the month in which the credit note is dated. The original invoice's status flips to "partially reversed" or "fully reversed" depending on whether the cumulative credit-note reversal equals the original taxable value.

**Debit Notes** are supported in the schema and template but are very rarely used in our flow — they would apply only if we needed to correct an invoice upward (for example, if a line was billed at a lower rate than it should have been). In practice, when a billing error of this kind occurs we issue a credit note for the wrong invoice and a fresh tax invoice for the correct amount, because that is easier to reconcile on the GSTR-1 side.

**Legacy Receipts** are an internal-only category we keep for historical pre-GST orders that predate the tax module. They are not currently issued, and they are not picked up by any of the GST returns. They exist purely so that the database can keep a paper trail for old orders we have inherited from the pre-tax-module era.

The exact rule the engine uses to pick which of these document types to issue is: if the seller is composition or unregistered, issue a Bill of Supply (because they cannot collect GST). If the seller is regularly registered and the order has only taxable items, issue a Tax Invoice. If the seller is regularly registered and the order has only exempt or nil-rated items, issue a Bill of Supply (because there is no GST to show). If the seller is regularly registered and the order has a mix of taxable and exempt items, issue an Invoice-cum-Bill of Supply.

---

## 5. What appears on the invoice — the field-by-field walkthrough

Every printed document contains the following fields, in roughly the order they appear on the page.

The top of the document carries a heading that names the document type explicitly — "Tax Invoice", "Bill of Supply", "Invoice-cum-Bill of Supply", or "Credit Note". This is required by CBIC so the recipient can identify the document at a glance without reading the body.

Immediately below the heading we display the document number (which is generated by our monotonic per-seller per-financial-year per-document-type sequence, so the same seller will never produce two invoices with the same number in the same year), the document date, the financial year ("2025-26" format), and the invoice type label (the legal sub-category, distinct from the document type).

For credit and debit notes, we also show the original document reference — the invoice number and date that the credit/debit note is reducing or increasing. This is also required by CBIC for tying credit notes back to their source invoices, both for the supplier's GSTR-1 §9B reporting and for the recipient's reverse-claim of input tax credit.

We then display three address blocks. The supplier block carries the supplier's legal business name, GSTIN, two-digit state code, and full registered address. The "billed-to" block carries the customer's name, GSTIN if they have one, and billing address. The "shipped-to" block carries the shipping address — this may be identical to the billed-to address, or different if the customer has shipped the goods to a third party. The two-letter place-of-supply state code is displayed prominently alongside, because that is the field auditors check first to determine whether the supply was intra-state or inter-state.

A reverse-charge applicability flag is shown explicitly. For ordinary marketplace transactions, reverse charge does not apply, but the field is always shown so a reader does not have to assume. The reason for any non-default reverse-charge state is recorded in a separate field on the document.

The line-item table contains every product on the sub-order, in the order they were added. Each row shows the line number, the product name (with the seller's SKU as a smaller sub-line), the HSN or SAC code for that product (HSN for goods, SAC for services such as shipping or convenience fees), the unit-of-quantity code from the CBIC's UQC master (so "PCS" for pieces, "KGS" for kilograms, "MTR" for metres), the quantity, the unit price in rupees, the taxable value, the GST rate as a percentage, the CGST, SGST and IGST amounts in rupees, and the line total. For documents whose type does not display GST columns (Bill of Supply), the GST rate and split columns are simply omitted from the table.

We display non-product lines on the invoice as well. Shipping, if charged, is its own line with its own HSN/SAC and GST rate (shipping carries GST at the rate configured in `tax_config.shipping_gst_rate_bps`, currently 18 percent under SAC 996812). Gift-wrap, convenience fee, and COD fee, if applicable, also appear as separate lines with their own SACs and GST treatment. The discount, if it applies to the whole order rather than per-line, appears as a negative line so that the math reconciles top-to-bottom.

At the bottom we have a totals table. It shows the total taxable value (the sum of all line taxable values), the total CGST, SGST, IGST, and cess, the total tax (sum of those four), the round-off line (positive or negative), and the grand total in rupees. We also print the grand total in English words, because CBIC requires the amount to be expressed in words as well as in figures on every tax invoice — and our amount-in-words formatter follows the Indian numbering system, so 12,34,567.89 prints as "Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven and Eighty Nine Paise Only" rather than the American "One Million Two Hundred Thirty Four Thousand…".

A small footer line records the line count, the currency (always INR for the marketplace today), and the payment mode (UPI, card, COD, or wallet). For documents that are subject to e-invoicing under the GSTN's Invoice Registration Portal, the footer is followed by an e-invoice block — see the next section.

---

## 6. E-invoicing under the Invoice Registration Portal

CBIC mandates e-invoicing through the IRP for business-to-business supplies above a turnover threshold. The threshold has changed over time and is currently 5 crore rupees in aggregate turnover. We track each seller's aggregate turnover on their `SellerGstin` row (it is updated periodically from the seller's filed returns when available, or maintained manually by the seller), and we let sellers opt in to e-invoicing even below the threshold if they wish to.

The engine decides whether a given document needs to go through the IRP using three gates. First, the document type must be one that the IRP accepts — Tax Invoice, Invoice-cum-Bill of Supply, Credit Note, and Debit Note are all eligible; Bill of Supply, Legacy Receipt, voided drafts, and superseded documents are not. Second, the document must be B2B — there must be a recipient GSTIN on the document, because the IRP rejects B2C documents. Third, the supplier's turnover must exceed the threshold, OR the supplier must have explicitly opted in. If all three gates pass, the document is flagged "e-invoice pending" at the moment of issuance, and a separate background process picks it up and posts it to the IRP.

The IRP, on successful receipt, returns three pieces of information: an IRN (Invoice Reference Number, a 64-character hash), an Ack number (a numeric acknowledgement), and an Ack date (the timestamp the IRP received the document). It also returns a signed copy of the document content (a JSON blob signed with the IRP's private key) and a URL pointing to a QR code that encodes the IRN. All four pieces of information are persisted on the TaxDocument row, the document's e-invoice status flips from "pending" to "generated", and the printed PDF is regenerated with the e-invoice block visible.

The e-invoice block on the printed PDF contains the QR code as a scannable image, the IRN displayed as plain text below the QR, the Ack number and Ack date, and a footnote inviting the reader to scan the QR with the official GST e-Invoice mobile app to verify the document against the IRP. This is the most recent change in our codebase: until 2026-05-16 the IRN and Ack number were stored but never rendered on the PDF, which would have failed an audit. We have now wired the e-invoice block into every printed copy of an IRP-signed document.

CBIC permits cancellation of an e-invoice within 24 hours of the Ack date. Past the 24-hour window, we cannot cancel an IRP-signed invoice; instead, the only path is to issue a credit note for the full amount and a fresh invoice for the correct amount. The engine enforces this 24-hour window explicitly and will throw an "e-invoice cancellation window closed" error if anyone (admin or seller) attempts to cancel past the cutoff.

---

## 7. E-way bills

Rule 138 of the CGST Rules requires an e-way bill for the movement of goods exceeding a consignment value threshold (currently 50,000 rupees inter-state, with some state-specific intra-state thresholds). We capture this threshold in `tax_config.eway_bill_threshold_paise`, which the admin can change without a code deployment — and which the CA may want to advise on if the rules change.

For every sub-order, after the tax invoice is issued, the engine evaluates whether an e-way bill is required by comparing the consignment value (taxable value plus GST plus shipping) against the configured threshold. If required, an "e-way bill required" row is written and the seller (or an admin) can generate the e-way bill via the integrated provider. If not required, a "not required" row is written so that the audit trail records the explicit decision.

E-way bills carry a distance-based validity. The CBIC formula is that the bill is valid for one day per 100 kilometres of the planned shipment route, with an additional day per 200 km thereafter, up to a hard cap of 15 days. Our engine computes this validity at the moment the e-way bill is generated and stores both the issue timestamp (in IST) and the expiry timestamp on the row.

E-way bills can be cancelled within 24 hours of issuance, exactly the same window as e-invoices, and we enforce that 24-hour window in code with a dedicated "cancellation window closed" error past the cutoff. We also support an admin-override path for the rare case where an e-way bill needs to be manually adjusted by someone with `tax.ewayBill.override` permission; the override writes an audit row that includes the admin's id and reason.

---

## 8. Returns, credit notes, and Section 34 time-bar

When a customer raises a return and the goods are received back at the warehouse and approved through quality-control, the system automatically generates a credit note against the original tax invoice. The credit note carries the same supplier identity, the same recipient identity, the same place of supply, but a fresh document number from the credit-note sequence. The lines on the credit note mirror the QC-approved portion of the original lines — same product, same HSN, same GST rate — and the taxable value and GST on each line are computed proportionally from the original snapshot. We snapshot the original GST values at the time the invoice was issued, not at the time the return is approved, so even if the seller has subsequently changed the product's GST rate, the credit note reverses exactly what was originally charged.

A return that comes through quality-control in stages (for example, two of three returned units are approved on day 1 and the third is approved on day 5 after re-inspection) now produces multiple credit notes — one per QC cycle. The system computes the delta between the cumulative reversal implied by the current QC-approved quantity and the cumulative reversal already credited through prior credit notes for the same return, and the new credit note covers only that delta. This was a deliberate design change made on 2026-05-16 to support the realistic operational reality that QC approval is rarely a single event. If a re-call of the credit-note generator runs with no new QC-approved quantity since the last credit note, the system returns the most-recent credit note unchanged — the operation is idempotent at the "no new approvals" boundary.

Section 34 of the CGST Act sets a hard time-bar on credit notes: a credit note that reduces a recipient's input tax credit must be issued no later than 30 September of the financial year following the year of the original supply. Our engine enforces this cutoff exactly: it computes the cutoff as the end-of-day in IST on 30 September of the financial year after the one in which the original invoice was dated, and throws a "Section 34 time-barred" error if any code path attempts to issue a credit note past that date.

When a return is approved but the credit note cannot be issued because the time bar has lapsed, we have a fallback path: we issue a wallet adjustment instead, and we open an admin task that requires explicit two-stage approval before money moves. The wallet adjustment is a non-GST transaction (it does not reduce the original outward supply on GSTR-1, because the law no longer permits that reduction), but it does return value to the customer. The customer effectively receives a goodwill credit. This is something we would like your guidance on, because there are different schools of thought on how to handle the GST impact of such a goodwill credit in the seller's books.

---

## 9. GSTR-1 filing

Every regularly-registered seller has access to their GSTR-1 report directly from their seller portal, generated from our tax-document data. The report covers the six sections that apply to outward supplies, and each section can be exported as a CSV that mirrors the format the GSTN portal accepts.

**Section 4** is business-to-business — one row per tax invoice where the recipient has a GSTIN, showing invoice number, date, recipient GSTIN, place of supply, invoice value, taxable value, CGST, SGST, IGST, cess, and reverse-charge flag. **Section 5** is "B2C Large" — inter-state supplies to unregistered customers where the invoice value exceeds 2.5 lakh rupees, with one row per such invoice. **Section 7** is "B2C Small" — intra-state supplies to unregistered customers, plus inter-state below the Section 5 threshold, aggregated by state code and tax rate (one row per state-rate combination, not per invoice). **Section 9B** is the credit-note section, one row per credit note issued in the period, showing the credit-note number, date, recipient GSTIN, original invoice reference, and the reversed amounts. **Section 12** is the HSN-wise summary, where every supply made in the period is grouped by HSN and tax rate, and the aggregate quantity, taxable value, and tax breakdown are reported. **Section 13** is the documents-issued count — the running serial range of every document type the seller issued in the period (so the auditor can confirm there are no gaps in the numbering).

Sellers can download any section as a CSV for the period they want to file. Platform-direct supplies (own-brand and SportSmart-direct) are handled separately under SportSmart's own GSTIN's GSTR-1, not aggregated into individual sellers' returns.

We have separate (smaller) generators for GSTR-3B and GSTR-8 as well. GSTR-3B is the monthly liability return, and we generate it for SportSmart's own GSTIN aggregating its share of platform revenue. GSTR-8 is the TCS return, mandatory for marketplace operators, and we produce one row per seller per filing period reporting the gross supply value and TCS collected.

---

## 10. Audit trail and tamper evidence

Every action that touches a tax document — issuance, status transition, PDF generation, e-invoice generation, e-way bill generation, credit note issuance, cancellation, admin override — writes a row to the audit log. The audit log is a single append-only table with no UPDATE or DELETE permission granted to anyone except the database administrator, and every row carries a SHA-256 hash that chains it to the previous row. The hash is computed deterministically from the previous row's hash plus a canonical serialisation of the current row's payload, so any tampering — adding, removing, or modifying a row — would break the chain at that point and every row after it.

A separate background process, the audit chain anchor, runs hourly and writes a checkpoint row to a separate table. The checkpoint captures the current head of the chain (the highest audit-log id at that moment) and its computed hash. The checkpoint table is also append-only, and its rows are numbered monotonically. To verify the integrity of the chain at any point in the past, an auditor would: pick a checkpoint, replay the chain from the previous checkpoint's "covers up to" id, recompute the hash, and compare against the recorded hash. If the hashes match, every row between the two checkpoints is provably unmodified. We have just enabled this anchor process by default (2026-05-16); prior to that it was opt-in and had not been running in production, which the CA should note as a gap in the historical record.

The audit log also records who initiated every action — the admin's id if it was an admin action, the seller's id if it was the seller, "SYSTEM" if it was an automated job — and the IP address and user agent if the action came from an HTTP request. For tax-mode changes specifically (turning STRICT mode on or off, or auditor mode), there is no automated path; only an admin with the `tax.configure` permission can change the mode, and every change writes both an audit row and an immediate notification to a configured channel.

---

## 11. Statutory document retention (Section 36)

CGST Section 36 requires us to retain every tax invoice, every credit note, every debit note, and the supporting books and records for at least 72 months from the due date of furnishing the annual return for the year to which the documents relate — effectively eight years. Our implementation uses an eight-year retention window by default (configurable per-deployment via `TAX_DOCUMENT_RETENTION_YEARS`), and our retention service computes for every customer or seller a summary that distinguishes between documents that have aged out of the retention window and those still under statutory hold.

This is important when the platform receives a Right-to-be-Forgotten request from a customer. The Digital Personal Data Protection Act gives customers the right to ask for the erasure of their personal data, but Section 36 of the CGST Act overrides this where the data is part of a statutorily-retained tax document. Our implementation handles this conflict by redacting personal data from the customer's row in the User table — first name, last name, phone, login email — while leaving the snapshot of those fields on the tax documents intact. The tax document carries the customer's name and address as it was at the time of issuance, because the legal record of who paid the GST cannot be retroactively edited. Erasure requests against documents under statutory hold are not refused; they are partially honoured — we redact what we can while keeping the statutorily-required portion intact.

The retention service surfaces a clear breakdown to the admin who is processing an erasure request: how many of the customer's documents are still under statutory hold, what the latest expiry is, what would actually get redacted, and what would have to stay. The customer is also informed of this in the email they receive when their erasure request is acknowledged.

---

## 12. Audit modes and strictness

The engine has three operational modes that the admin can switch between at runtime. In **OFF** mode the engine performs no validation — missing HSN codes, missing GST rates, malformed GSTINs, and inconsistent state codes are all silently allowed and the code falls back to defaults. This mode exists only for initial onboarding when the seller catalog is being seeded and the data is incomplete; it should never be on during a production day.

In **AUDIT** mode the engine performs every validation it would in strict mode, but instead of throwing an error on a violation, it logs the violation as a structured event and lets the request proceed. The intent of this mode is to act as a soak period — typically two weeks immediately after a major seller-onboarding batch — during which compliance reviews the violations and either fixes the data or accepts a documented exception. AUDIT mode is the recommended default during catalog cleanup.

In **STRICT** mode the engine throws an error on any violation, refusing to issue a document until the data is correct. This is the production mode and the only mode that should be on once the seller catalog is in clean state. Switching to STRICT requires explicit confirmation in the admin UI and writes a high-visibility audit row.

The current mode is read from the `tax_config` table at runtime, cached for one minute, and explicitly cache-busted when an admin changes the mode. The cache exists because the tax engine is on the hot path of every order placement and the lookup is cheap when cached.

---

## 13. Areas where we would specifically like your guidance

While the engine implements the law as we have understood it, there are a number of operational decisions that we have made provisionally and on which we would value your formal sign-off.

First, the **inclusive vs. exclusive pricing choice** is currently left to the seller. Some sellers prefer to set prices as gross-inclusive of GST because that simplifies their P&L, others prefer exclusive because it makes the GST line on the invoice easier to read. Both modes produce mathematically-correct invoices, but we would like your view on whether there is a preferred mode from an audit standpoint, particularly for B2B customers who may want a cleaner CGST/SGST breakdown for ITC purposes.

Second, the **place-of-supply default for B2B orders** is currently the shipping state, not the buyer's GSTIN state. The configuration permits both, but the default we ship with is shipping-state. CBIC Section 10 permits the supplier to choose either, with caveats. We would like your view on which we should default to, and whether we need to surface the choice to the seller on a per-order basis.

Third, the **goodwill credit path for time-barred returns** — when a return is approved but the credit note cannot be issued because Section 34's cutoff has lapsed, we currently issue a wallet adjustment that does not flow through GST. The customer gets back the rupee amount, but our seller does not recover the GST they paid on the original supply. We would like your view on whether there is a permissible workaround under any of the recent CBIC notifications, or whether the seller simply has to write off that portion as a goodwill cost.

Fourth, the **TCS carry-forward across periods** — when a credit note is issued in a period later than the original supply, and the net TCS for the later period would go negative, we carry the excess forward. We believe this is consistent with how the GSTR-8 form is structured (it does not accept negative values), but we would like your confirmation that the carry-forward approach is acceptable and that we are not required to file a refund claim instead.

Fifth, the **e-invoice opt-in policy** — we currently let sellers below the 5-crore turnover threshold opt in to e-invoicing voluntarily, but we do not require it. We would like your view on whether voluntary opt-in is operationally sensible for the marketplace, or whether we should encourage all B2B-active sellers to opt in regardless of their turnover, to simplify reconciliation.

Sixth, the **HSN code accuracy responsibility** — we currently let sellers choose the HSN code for their products from the CBIC HSN master, and we validate the format but not the business correctness of the choice. Misclassified HSN codes are a known risk in marketplace supply, and the consequence (interest plus penalty on the under-collected GST) typically falls on the supplier, not the platform. We would like your view on whether we should be doing additional checks — perhaps surfacing a "you have classified this in HSN 6203 but most retailers classify similar items in HSN 6204; please confirm" interactive prompt — and whether there are specific HSN codes you would flag for extra review.

Seventh, the **invoice numbering scheme** is currently per-seller, per-financial-year, per-document-type, monotonic. This means seller A's invoices for FY 2025-26 might run "A/25-26/TI/00001" through "A/25-26/TI/00450", and credit notes start a separate sequence "A/25-26/CN/00001". This is consistent with CBIC Rule 46 and produces clean GSTR-1 documents-issued sections, but we would like your formal blessing on the convention before we lock it in.

Eighth, the **statutory retention period of 8 years** — we have implemented this as the default but it is environment-configurable. We would like your view on whether 8 years is the right default given Section 36 (which technically reads "72 months from the due date of furnishing the annual return"), or whether we should extend it to handle longer assessment windows during open litigation.

---

## 14. What we have NOT implemented yet, and why

There are three notable absences in our implementation that we want to flag upfront so they do not come as a surprise during your review.

We do not currently issue a self-invoice on reverse-charge supplies. We have the schema field for reverse-charge applicability on every TaxDocument, and the field is shown explicitly on the printed invoice, but we have not yet built the path where the marketplace itself acts as the issuer on a reverse-charge supply (which would apply, for example, to certain unregistered supplier scenarios). We do not currently support any such supplier on the platform, but if you anticipate that we will, we should build this before we onboard one.

We do not currently support refund vouchers (CGST Rule 51) for partial advance receipts. All of our orders are billed at fulfilment, not at advance receipt, so the refund-voucher path has not yet been needed. If you anticipate any change to our payment model — for example, allowing customers to pre-fund their wallet against a future purchase — we should build the refund-voucher path first.

We have not yet built any return for GSTR-9 (the annual return) or GSTR-9C (the reconciliation). Both are out of scope for the current sprint but are on the roadmap. We assume your firm will be helping with the manual filing of GSTR-9 and GSTR-9C until we have automated those.

---

## 15. Summary and ask

We believe our tax engine is operationally correct, mathematically rigorous, and aligned with CBIC requirements. The areas that need your formal sign-off are the eight policy decisions in Section 13 above. The areas where we know we have gaps are listed in Section 14. The full source for every claim in this document is in the codebase under `apps/api/src/modules/tax/`, and we are happy to walk you through any function or table in detail at our meeting.

Our specific asks from you in the meeting are: confirm that the math, the rounding policy, and the document-picking logic all match your understanding of the law; advise on the eight policy decisions in Section 13; let us know which of the gaps in Section 14 we should prioritise; and review the e-invoice block on a sample PDF (we will bring one) to confirm it satisfies CBIC's printed-form requirements.

Thank you for your time on this review.

**— SportSmart Engineering**
