# Franchise Lifecycle — End-to-End Flow Chart

> Mapped from the actual codebase (NestJS API + `web-franchise` portal + `logistics-facade` Delhivery integration).
> Render the Mermaid blocks on GitHub, in VS Code (Markdown Preview Mermaid), or at https://mermaid.live.

## Two important reality-checks vs. the verbal description
1. **"Super admin accepts the order"** is actually the **order *verification*** step (`POST /admin/orders/:id/verify`, perm `orders.verify`). Verification runs the allocator, routes the sub-order to the franchise, and starts the 24h accept clock. The franchise then does the real *accept*.
2. **"7-day commission"** — the code locks commission after `returnWindowEndsAt`, driven by env `RETURN_WINDOW_DAYS` whose **default is 14 days** (not 7). "7 days" is the business intent; set `RETURN_WINDOW_DAYS=7` to match. Same window governs return eligibility.
3. In returns, **approve / QC / refund are admin (franchise-scoped admin via `/admin/franchise-returns/*`)**; the franchise *owner* portal only gets read + mark-received + upload-QC-evidence.

---

## 0 · Overview (the spine)

```mermaid
flowchart LR
    O1["**1 Onboarding**<br/>register → KYC → approve → ACTIVE"] --> O2["**2 Catalog + Procurement**<br/>stock the franchise"]
    O2 --> O3["**3 Customer Order**<br/>verify → route → accept"]
    O3 --> O4["**4 Fulfillment**<br/>4 photos → PACKED"]
    O4 --> O5["**5 Delhivery**<br/>auto-book → pickup → deliver"]
    O5 --> O6["**6 Commission**<br/>locked after return window"]
    O6 --> O7["**7 Returns**<br/>within window (optional)"]
    classDef p fill:#eef4ff,stroke:#3b6fd4,color:#13316b,font-weight:bold;
    class O1,O2,O3,O4,O5,O6,O7 p;
```

---

## 1 · Registration & Admin Approval (onboarding)

```mermaid
flowchart TD
    A1["Franchise self-registers<br/>POST /franchise/auth/register"]:::fr --> A2["status = PENDING<br/>verification = NOT_VERIFIED"]:::st
    A2 --> A3["Verify email via OTP<br/>POST /franchise/auth/verify-email"]:::fr
    A3 --> A4["Submit KYC — GSTIN, PAN,<br/>business + warehouse address<br/>POST /franchise/onboarding/submit"]:::fr
    A4 --> A5["verification = UNDER_REVIEW<br/>(payload snapshot saved)"]:::st
    A5 --> A6{"Admin reviews KYC<br/>GSTN portal + PAN attest"}:::adm
    A6 -->|Reject + reason| A7["verification = REJECTED<br/>profile unlocked → edit & resubmit"]:::st
    A7 --> A4
    A6 -->|Approve| A8["verification = VERIFIED 🔒<br/>profile locked · status = APPROVED"]:::st
    A8 --> A9["Add bank details (AES-256-GCM)<br/>POST /franchise/bank-details"]:::fr
    A9 --> A10{"Admin ACTIVATES<br/>needs VERIFIED + bank on file"}:::adm
    A10 --> A11["status = ACTIVE ✅<br/>can browse · procure · fulfill"]:::ok

    classDef fr fill:#e3f2fd,stroke:#1976d2,color:#0d47a1;
    classDef adm fill:#fff3e0,stroke:#f57c00,color:#e65100;
    classDef st fill:#fafafa,stroke:#bdbdbd,color:#616161;
    classDef ok fill:#e8f5e9,stroke:#388e3c,color:#1b5e20;
```

**Steps:** register (PENDING) → email OTP → KYC submit (UNDER_REVIEW) → admin GSTN/PAN check → approve (VERIFIED, profile **locked**, APPROVED) → bank details → admin activate (**ACTIVE**).
**Gates:** email must be verified before KYC; GSTIN[0:2]=state, GSTIN[2:12]=PAN; PENDING→APPROVED needs VERIFIED + both tax IDs; APPROVED→ACTIVE needs bank details. Perm `franchise.approve`. Contract expiry later auto-flips ACTIVE→SUSPENDED (hourly cron).

---

## 2 · Catalog Browsing → Procurement → Receive → Settle (stocking the franchise)

```mermaid
flowchart TD
    B1["Browse available products<br/>GET /franchise/catalog/available-products"]:::fr --> B2["Request to list a SKU<br/>POST /franchise/catalog/mappings → PENDING_APPROVAL"]:::fr
    B2 --> B3{"Admin reviews mapping"}:::adm
    B3 -->|Reject| B3a["REJECTED"]:::st
    B3 -->|Approve| B4["mapping APPROVED + active<br/>SKU now procurable"]:::ok

    B4 --> C1["Create procurement request (DRAFT)<br/>POST /franchise/procurement"]:::fr
    C1 --> C2["Submit for approval (SUBMITTED, SLA 48h)<br/>POST /franchise/procurement/:id/submit"]:::fr
    C2 --> C3{"Admin approves<br/>qty ≤ requested + landed cost"}:::adm
    C3 -->|Reject| C3a["REJECTED"]:::st
    C3 -->|Approve / partial| C4["APPROVED / PARTIALLY_APPROVED"]:::st
    C4 --> C5["Admin dispatches to franchise<br/>PATCH /admin/procurement/:id/dispatch → DISPATCHED + tracking"]:::adm
    C5 --> C6["Franchise receives & checks (GRN)<br/>POST /franchise/procurement/:id/receive<br/>receivedQty + damagedQty + photos"]:::fr
    C6 --> C7{"Damaged units<br/>claimed (with photos)?"}
    C7 -->|Yes| C8["ProcurementDamageClaim = PENDING"]:::st
    C8 --> C9{"Admin reviews claim"}:::adm
    C9 -->|Approve| C10["Units written off →<br/>drop from payable"]:::st
    C9 -->|Reject| C11["Units saleable →<br/>franchise still pays"]:::st
    C7 -->|No| C12["Good stock → FranchiseStock.onHandQty<br/>status RECEIVED / PARTIALLY_RECEIVED"]:::st
    C10 --> C12
    C11 --> C12
    C12 --> C13["Admin settles payable<br/>PATCH /admin/procurement/:id/settle → SETTLED<br/>posts PROCUREMENT_COST + FEE to ledger"]:::adm
    C13 --> C14["Rolls into franchise settlement cycle<br/>(approve → pay, with tax deductions)"]:::ok

    classDef fr fill:#e3f2fd,stroke:#1976d2,color:#0d47a1;
    classDef adm fill:#fff3e0,stroke:#f57c00,color:#e65100;
    classDef st fill:#fafafa,stroke:#bdbdbd,color:#616161;
    classDef ok fill:#e8f5e9,stroke:#388e3c,color:#1b5e20;
```

**Procurement statuses:** `DRAFT → SUBMITTED → APPROVED / PARTIALLY_APPROVED / REJECTED → DISPATCHED → PARTIALLY_RECEIVED / RECEIVED → SETTLED` (+`CANCELLED` from DRAFT/SUBMITTED).
**Damage claim:** `PENDING → APPROVED` (written off, excluded from payable) `/ REJECTED` (saleable, still billed). Photo proof mandatory. Receipt is delta-idempotent (no double-stock on retry).

---

## 3 · Customer Order → Super-Admin Verify → Franchise Accept

```mermaid
flowchart TD
    D1["Customer places & pays order<br/>(COD / Razorpay)"]:::cust --> D2["Allocator routes item to franchise node<br/>SubOrder.franchiseId set · stock reserved"]:::sys
    D2 --> D3["Super-admin VERIFIES order<br/>POST /admin/orders/:id/verify<br/>(allocation engine + 24h accept deadline)"]:::sa
    D3 --> D4["Order surfaces in franchise portal<br/>GET /franchise/orders (acceptStatus = OPEN)"]:::sys
    D4 --> D5{"Franchise responds<br/>within 24h?"}:::fr
    D5 -->|Reject OR SLA timeout| D6["acceptStatus = REJECTED<br/>stock unreserved · auto-reassign attempted<br/>(rejectionType MANUAL / AUTO_SLA)"]:::st
    D5 -->|Accept| D7["acceptStatus = ACCEPTED<br/>PATCH /franchise/orders/:id/accept<br/>master → SELLER_ACCEPTED"]:::ok

    classDef cust fill:#ede7f6,stroke:#673ab7,color:#311b92;
    classDef sys fill:#f5f5f5,stroke:#9e9e9e,color:#424242;
    classDef sa fill:#fce4ec,stroke:#c2185b,color:#880e4f;
    classDef fr fill:#e3f2fd,stroke:#1976d2,color:#0d47a1;
    classDef st fill:#fafafa,stroke:#bdbdbd,color:#616161;
    classDef ok fill:#e8f5e9,stroke:#388e3c,color:#1b5e20;
```

**Accept SLA:** 24h from verification; a 5-min cron auto-rejects (`AUTO_SLA`) past deadline. Accept/reject is row-locked (`SELECT FOR UPDATE`) to race-guard the cron. Contract-expiry also blocks accept.

---

## 4 · Fulfillment — Upload 4 Images → Mark as PACKED

```mermaid
flowchart TD
    E1["Upload package photos (max 4, ≤8 MB each)<br/>POST /franchise/sub-orders/:id/shipment-evidence<br/>kind = PACKING"]:::fr --> E2{"4 photos uploaded?"}
    E2 -->|No| E1
    E2 -->|Yes| E3["Mark as PACKED<br/>PATCH /franchise/orders/:id/status {PACKED}"]:::fr
    E3 --> E4["Gate inside TX (FOR UPDATE):<br/>require 4 PACKING photos<br/>(TOCTOU-safe)"]:::sys
    E4 -->|< 4| E4a["400 — needs 4 photos"]:::st
    E4 -->|OK| E5["fulfillmentStatus = PACKED<br/>photos frozen · packedAt / packedBy set<br/>emit SHIPMENT_PACKED event"]:::ok

    classDef fr fill:#e3f2fd,stroke:#1976d2,color:#0d47a1;
    classDef sys fill:#f5f5f5,stroke:#9e9e9e,color:#424242;
    classDef st fill:#fafafa,stroke:#bdbdbd,color:#616161;
    classDef ok fill:#e8f5e9,stroke:#388e3c,color:#1b5e20;
```

**Gate:** exactly 4 PACKING photos required to leave `UNFULFILLED → PACKED` (env `SHIPMENT_EVIDENCE_REQUIRED_PHOTOS`, default 4), counted inside the transaction. Photos frozen post-pack to prevent tampering; sub-order must be `ACCEPTED` first.

---

## 5 · Delhivery — Auto-Book → Label → Pickup → Delivered

```mermaid
flowchart TD
    F1["PACKED event fires"]:::sys --> F2["DelhiveryAutoBookHandler<br/>resolve warehouse + transport_speed (NDD/standard)<br/>POST /api/cmu/create.json"]:::sys
    F2 --> F3["AWB (waybill) returned → attach to sub-order<br/>fulfillmentStatus = SHIPPED · courier = Delhivery"]:::st
    F3 --> F4["Generate shipping label PDF<br/>GET /api/p/packing_slip?wbns=<awb>"]:::sys
    F4 --> F5["Create pickup request for warehouse<br/>POST /fm/request/new/"]:::sys
    F5 --> F6["Rider collects parcel → PICKED_UP scan"]:::dl
    F6 --> F7["IN_TRANSIT → OUT_FOR_DELIVERY<br/>(webhook scans, ordering-guarded)"]:::dl
    F7 --> F8["DELIVERED webhook<br/>fulfillmentStatus = DELIVERED · deliveredAt set"]:::ok
    F8 --> F9["Tax invoice (GST) generated<br/>return window opens · master order rolls up"]:::sys

    classDef sys fill:#f5f5f5,stroke:#9e9e9e,color:#424242;
    classDef st fill:#fafafa,stroke:#bdbdbd,color:#616161;
    classDef dl fill:#e0f2f1,stroke:#00897b,color:#004d40;
    classDef ok fill:#e8f5e9,stroke:#388e3c,color:#1b5e20;
```

**Auto-book** is triggered by the `PACKED` status-changed event (`delhivery-auto-book.handler.ts`); idempotent (skips if AWB exists). Webhook ingestion is IP-allowlisted + HMAC-verified + deduped on `(provider, eventKey)`. Out-of-order scans dropped via `lastTrackingEventAt` guard. *(One explorer flagged the PACKED→auto-book wiring as recently added — confirm it's enabled in your target env.)*

---

## 6 · Commission — Locked After the Return Window

```mermaid
flowchart TD
    G1["DELIVERED → returnWindowEndsAt set<br/>now + RETURN_WINDOW_DAYS (default 14; set 7 for 7-day)"]:::sys --> G2["Commission cron (every 15s)<br/>finds DELIVERED sub-orders past window"]:::sys
    G2 --> G3{"Eligible?<br/>commissionProcessed=false ·<br/>no live return · no active dispute"}
    G3 -->|No| G2
    G3 -->|Yes| G4["Calc: platformMargin = base × rate%<br/>franchiseEarning = base − platformMargin<br/>lock ledger (ONLINE_ORDER) · commissionProcessed=true<br/>emit commission.locked"]:::ok
    G4 --> G5["Admin builds settlement cycle<br/>deduct GST 18% + TCS 1% (§52) + TDS (§194-O)"]:::adm
    G5 --> G6["Approve (MFA) → mark PAID<br/>net = gross − GST − TCS − TDS wired to bank"]:::ok

    classDef sys fill:#f5f5f5,stroke:#9e9e9e,color:#424242;
    classDef adm fill:#fff3e0,stroke:#f57c00,color:#e65100;
    classDef ok fill:#e8f5e9,stroke:#388e3c,color:#1b5e20;
```

**Ledger flow:** `PENDING → ACCRUED (commission locked) → SETTLED (paid)` (+`REVERSED` on return/void). Rate = per-franchise `onlineFulfillmentRate` (snapshotted on the order). "Your Earning" shown to franchise = net payable after GST+TCS+TDS.

---

## 7 · Returns Within the Window (optional branch)

```mermaid
flowchart TD
    H1["Customer requests return in window<br/>POST /customer/returns → REQUESTED"]:::cust --> H2{"Admin approves?"}:::sa
    H2 -->|Reject| H2a["REJECTED"]:::st
    H2 -->|Approve| H3["Schedule reverse pickup (Delhivery RTO)<br/>PICKUP_SCHEDULED → IN_TRANSIT"]:::sa
    H3 --> H4["Franchise receives parcel<br/>PATCH .../mark-received → RECEIVED<br/>+ uploads QC photos"]:::fr
    H4 --> H5{"Admin QC decision"}:::sa
    H5 -->|Reject| H5a["QC_REJECTED<br/>no refund / item back to customer"]:::st
    H5 -->|Approve / partial| H6["QC_APPROVED / PARTIALLY_APPROVED<br/>commission clawed back (proportional franchiseEarning)"]:::st
    H6 --> H7["Admin initiates refund<br/>WALLET (instant) / original / bank<br/>REFUND_PROCESSING → REFUNDED"]:::sa
    H7 --> H8["Return COMPLETED ✅"]:::ok

    classDef cust fill:#ede7f6,stroke:#673ab7,color:#311b92;
    classDef sa fill:#fce4ec,stroke:#c2185b,color:#880e4f;
    classDef fr fill:#e3f2fd,stroke:#1976d2,color:#0d47a1;
    classDef st fill:#fafafa,stroke:#bdbdbd,color:#616161;
    classDef ok fill:#e8f5e9,stroke:#388e3c,color:#1b5e20;
```

**Return statuses:** `REQUESTED → APPROVED → PICKUP_SCHEDULED → IN_TRANSIT → RECEIVED → QC_APPROVED / PARTIALLY_APPROVED / QC_REJECTED → REFUND_PROCESSING → REFUNDED → COMPLETED` (+`REFUND_FAILED`, `CANCELLED`, dispute overrides). **Commission reversal happens at QC-approve time** (not refund), reverses *proportional franchiseEarning*, gated by `COMMISSION_REVERSAL_WINDOW_DAYS` (default 30 → otherwise held for next-cycle clawback). Refunds flow `RefundInstruction → RefundProcessor → WalletService`. Perms: `franchise.returns.manage`, `franchise.returns.refund`.

---

## Status reference

| Domain | Status values |
|---|---|
| **Franchise account** | PENDING · APPROVED · ACTIVE · SUSPENDED · DEACTIVATED |
| **KYC verification** | NOT_VERIFIED · UNDER_REVIEW · VERIFIED · REJECTED |
| **Catalog mapping** | PENDING_APPROVAL · APPROVED · REJECTED · STOPPED · SUSPENDED |
| **Procurement** | DRAFT · SUBMITTED · APPROVED · PARTIALLY_APPROVED · REJECTED · DISPATCHED · PARTIALLY_RECEIVED · RECEIVED · SETTLED · CANCELLED |
| **Damage claim** | PENDING · APPROVED · REJECTED |
| **Sub-order accept** | OPEN · ACCEPTED · REJECTED · CANCELLED |
| **Sub-order fulfillment** | UNFULFILLED · PACKED · SHIPPED · IN_TRANSIT · OUT_FOR_DELIVERY · DELIVERED · CANCELLED |
| **Master order** | PENDING_PAYMENT · PLACED · VERIFIED · ROUTED_TO_SELLER · SELLER_ACCEPTED · PARTIALLY_SHIPPED · DISPATCHED · PARTIALLY_DELIVERED · DELIVERED · PARTIALLY_CANCELLED · CANCELLED · EXCEPTION_QUEUE |
| **Finance ledger** | PENDING · ACCRUED · HOLD · SETTLED · REVERSED |
| **Franchise settlement** | PENDING · APPROVED · PAID · FAILED · ON_HOLD · PARTIALLY_PAID |
| **Settlement cycle** | DRAFT · PREVIEWED · APPROVED · READY_FOR_PAYOUT · PAID · CANCELLED |
| **Return** | REQUESTED · APPROVED · REJECTED · PICKUP_SCHEDULED · IN_TRANSIT · RECEIVED · QC_APPROVED · PARTIALLY_APPROVED · QC_REJECTED · REFUND_PROCESSING · REFUNDED · REFUND_FAILED · COMPLETED · CANCELLED · DISPUTE_* |

## Cross-cutting branches (not on the happy path)
- **Contract expiry** → hourly cron auto-flips ACTIVE→SUSPENDED; blocks *all* franchise transactions (procurement, POS, order accept).
- **Partial states** → PARTIALLY_SHIPPED / PARTIALLY_DELIVERED / PARTIALLY_CANCELLED master-order rollups for multi-node orders.
- **POS** → in-store sale, void (24h window), return, and end-of-day reconciliation (MATCHED/VARIANCE → admin approve).
- **Settlement holds** → ON_HOLD (compliance) and PARTIALLY_PAID (bank), plus cycle PREVIEW (dry-run) and CANCELLATION.

---

## Single end-to-end diagram (all 7 phases collapsed)

```mermaid
flowchart TD
  subgraph P1["1 · Onboarding & Admin Approval"]
    A1["Franchise registers<br/>POST /franchise/auth/register · PENDING"]
    A2["Verify email (OTP)"]
    A3["Submit KYC — GSTIN, PAN, addresses<br/>UNDER_REVIEW"]
    A4{"Admin reviews KYC<br/>GSTN + PAN"}
    A5["REJECTED — edit & resubmit"]
    A6["VERIFIED 🔒 profile locked · APPROVED"]
    A7["Add bank details (encrypted)"]
    A8{"Admin activates<br/>VERIFIED + bank"}
    A9["status = ACTIVE ✅"]
    A1-->A2-->A3-->A4
    A4-->|reject|A5-->A3
    A4-->|approve|A6-->A7-->A8-->A9
  end

  subgraph P2["2 · Catalog → Procurement → Receive → Settle"]
    B1["Browse catalog<br/>GET /franchise/catalog/available-products"]
    B2["List SKU → PENDING_APPROVAL"]
    B3{"Admin approves mapping"}
    B3r["REJECTED"]
    B4["Mapping APPROVED"]
    B5["Create procurement · DRAFT"]
    B6["Submit → SUBMITTED (SLA 48h)"]
    B7{"Admin approves<br/>qty + landed cost"}
    B7r["REJECTED"]
    B8["APPROVED / PARTIALLY_APPROVED"]
    B9["Admin dispatch → DISPATCHED + tracking"]
    B10["Franchise receives & checks (GRN)<br/>receivedQty + damagedQty + photos"]
    B11{"Damaged units<br/>claimed?"}
    B12["DamageClaim PENDING → admin:<br/>approve = write-off · reject = billed"]
    B13["Good stock → onHandQty · RECEIVED"]
    B14["Admin settles → SETTLED<br/>POST ledger PROCUREMENT_COST + FEE"]
    B1-->B2-->B3
    B3-->|reject|B3r
    B3-->|approve|B4-->B5-->B6-->B7
    B7-->|reject|B7r
    B7-->|approve|B8-->B9-->B10-->B11
    B11-->|yes|B12-->B13
    B11-->|no|B13
    B13-->B14
  end

  subgraph P3["3 · Customer Order → Verify → Accept"]
    C1["Customer places & pays (COD / Razorpay)"]
    C2["Allocator routes to franchise node<br/>stock reserved"]
    C3["Super-admin VERIFIES<br/>POST /admin/orders/:id/verify · 24h deadline"]
    C4["Shows in franchise portal · acceptStatus OPEN"]
    C5{"Franchise responds<br/>within 24h?"}
    C6["REJECTED — unreserve · auto-reassign"]
    C7["ACCEPTED<br/>PATCH /franchise/orders/:id/accept"]
    C1-->C2-->C3-->C4-->C5
    C5-->|reject / SLA timeout|C6
    C5-->|accept|C7
  end

  subgraph P4["4 · Upload 4 Images → Mark PACKED"]
    D1["Upload photos (max 4, ≤8MB) · kind=PACKING<br/>POST /franchise/sub-orders/:id/shipment-evidence"]
    D2{"4 photos?"}
    D3["Mark PACKED · gate in TX (FOR UPDATE)"]
    D4["fulfillmentStatus = PACKED · photos frozen"]
    D1-->D2
    D2-->|incomplete|D1
    D2-->|4 photos ✓|D3-->D4
  end

  subgraph P5["5 · Delhivery — Auto-book → Pickup → Delivered"]
    E1["Auto-book on PACKED event<br/>resolve warehouse + transport_speed<br/>POST /api/cmu/create.json"]
    E2["AWB attached → SHIPPED"]
    E3["Generate label PDF"]
    E4["Create pickup request · POST /fm/request/new/"]
    E5["Rider picks up · PICKED_UP"]
    E6["IN_TRANSIT → OUT_FOR_DELIVERY (webhooks)"]
    E7["DELIVERED · deliveredAt set"]
    E8["Tax invoice generated"]
    E1-->E2-->E3-->E4-->E5-->E6-->E7-->E8
  end

  subgraph P6["6 · Commission (after return window)"]
    F1["Return window opens<br/>returnWindowEndsAt = now + RETURN_WINDOW_DAYS"]
    W1{"Return raised<br/>within window?"}
    F2["Commission cron (15s)<br/>finds past-window sub-orders"]
    F3{"Eligible?<br/>no live return / no dispute"}
    F4["Commission locked<br/>franchiseEarning = base − platformMargin"]
    F5["Settlement cycle · GST 18% + TCS 1% + TDS"]
    F6["Approve (MFA) → PAID · net to bank"]
    F1-->W1
    W1-->|no|F2-->F3
    F3-->|not yet|F2
    F3-->|eligible|F4-->F5-->F6
  end

  subgraph P7["7 · Returns Within the Window"]
    G1["Customer requests return · REQUESTED"]
    G2{"Admin approves?"}
    G2r["REJECTED"]
    G3["Schedule reverse pickup (Delhivery)<br/>PICKUP_SCHEDULED → IN_TRANSIT"]
    G4["Franchise mark-received → RECEIVED<br/>+ uploads QC photos"]
    G5{"Admin QC decision"}
    G5r["QC_REJECTED — no refund"]
    G6["QC_APPROVED · commission clawed back"]
    G7["Refund · WALLET/original/bank → REFUNDED"]
    G8["COMPLETED ✅"]
    G1-->G2
    G2-->|reject|G2r
    G2-->|approve|G3-->G4-->G5
    G5-->|reject|G5r
    G5-->|approve|G6-->G7-->G8
  end

  %% cross-phase spine
  A9 --> B1
  B14 -->|franchise now stocked| C1
  C7 --> D1
  D4 --> E1
  E8 --> F1
  W1 -->|yes| G1
  G6 -.->|reverse / withhold| F4

  %% styling
  classDef dec fill:#fff7d6,stroke:#d4a72b,color:#5b4708;
  classDef good fill:#e3f5e6,stroke:#2e9e4f,color:#14502a;
  classDef bad fill:#fbe4e4,stroke:#d04545,color:#7a1f1f;
  class A4,A8,B3,B7,B11,C5,D2,F3,G2,G5,W1 dec;
  class A9,C7,D4,E7,F6,G8 good;
  class A5,B3r,B7r,C6,G2r,G5r bad;
  style P1 fill:#eaf2ff,stroke:#3b6fd4;
  style P2 fill:#fff3e6,stroke:#e08a2b;
  style P3 fill:#fdecf3,stroke:#c2185b;
  style P4 fill:#eef0fb,stroke:#5b4ad4;
  style P5 fill:#e7f6f3,stroke:#1aa089;
  style P6 fill:#f3ecfb,stroke:#8e44c4;
  style P7 fill:#eaf7fb,stroke:#2b9fd4;
```
