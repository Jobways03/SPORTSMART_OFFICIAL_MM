# Module Boundaries - SPORTSMART Strict Modular Monolith

## Core Rules

1. Each module owns its business logic and data
2. No direct cross-module repository access
3. Cross-module access only through public facades
4. Database shared physically, owned logically per module
5. External integrations are anti-corruption adapters, not core logic
6. Internal events for async reactions; direct facade calls for sync decisions

## Module Ownership

| Module | Owns | Does NOT Own |
|--------|------|--------------|
| identity | users, auth, roles, sessions, permissions | seller details, addresses, bank/KYC |
| seller | onboarding, profile, pickup, bank, KYC, lifecycle | products, inventory, orders, settlements |
| catalog | categories, brands, products, variants, moderation | stock, search engine, cart, checkout |
| search | search API, indexing, search documents | product truth, stock truth, order logic |
| inventory | stock, reservations, deductions, adjustments | product definitions, cart, orders |
| cart | cart state, cart lines, quantities | checkout validation, orders, payments |
| checkout | pre-order validation orchestration | order lifecycle, payment capture |
| orders | master order, sub-orders, lifecycle/state machine | payment gateway, returns policy, settlements |
| payments | payment attempts, capture, refunds, webhooks | order creation, shipping, returns policy |
| cod | COD rules, decisions, reason codes | cart, orders, shipments, payments |
| shipping | shipments, AWB, tracking, NDR, RTO | order creation, payments, returns approval |
| returns | return requests, QC, disputes, decisions | payment refund execution, settlements engine |
| settlements | ledger entries, payout runs, statements | payment gateway, order lifecycle |
| affiliate | referral links, attribution, commissions | order truth, seller payouts |
| franchise | pincode mapping, service fees, earnings | shipment truth, order creation |
| notifications | templates, channels, dispatch | business decisions |
| admin-control-tower | dashboards, KPIs, override orchestration | actual business rule ownership |
| audit | audit logs, event logs, change tracking | business state truth |
| files | file metadata, uploads, access policies | QC logic, onboarding decisions |

## Dependency Direction

```
presentation -> application -> domain
infrastructure -> domain + application ports
```

NEVER: domain -> infrastructure, domain -> presentation
