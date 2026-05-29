# SportSmart Marketplace — Architecture (deep dive)

**Last generated:** 2026-05-13 (live code walk, all 9 apps + API + infra)
**Scope:** the entire monorepo at `SPORTSMART_OFFICIAL_MM`, end to end.
**Companions:**
- `docs/SYSTEM_DESIGN.md` — the longer system-design document (2026-03-27, partly out of date on port numbers — trust this doc on ports)
- `docs/architecture/{module-boundaries,dependency-matrix,event-catalog}.md` — strict ownership rules, cross-module access matrix, event names
- `docs/decisions/001..020-*.md` — twenty ADRs, the **canonical** source for *why* anything in the platform is shaped the way it is
- `docs/flows/commerce-lifecycle.md` — the eight named flows (A–H)
- `docs/runbooks/*.md` — operational cutovers (Phase 1.x → Phase 13)

This document is the one-page entry point. Where it says "see ADR-N" or "see runbook X", that's the deep source. The intent is that reading this one file gives you the working mental model for the whole codebase; the ADRs explain the *why*, and `git grep` shows the *how*.

---

## 1. TL;DR

SportSmart is a **multi-seller sports marketplace for India** (Razorpay payments, Shiprocket / iThink logistics, India Post pincodes). It is a **strict modular monolith** (ADR-001) built as:

- **One NestJS 11 backend** (`apps/api`, port `8000`) — ~1,741 TypeScript files, ~156k LoC, ~41 business modules.
- **Eight Next.js 15 / React 19 frontends** (ports `4000` – `4007`) — ~466 TS/TSX files, ~145k LoC.
- **One PostgreSQL 16 database** (Prisma 6, **47 split-schema `.prisma` files** under `apps/api/prisma/schema/`, ~6.9k schema lines).
- **Redis 7** for caching, fenced locks, rate limiting.
- **OpenSearch** for full-text product discovery (not in local `docker-compose`).
- **S3 + Cloudinary** for files; **WhatsApp Cloud API** + **Gmail SMTP** for messaging; **Anthropic Claude + Google Gemini** for AI features.
- **pnpm 10** workspace + **Turborepo 2** orchestration.

The platform is mid-way through a **10-phase Returns + Disputes redesign** (ADRs 003 → 015) plus three follow-on phases (ADRs 016 → 018). Foundations (idempotency, money VO, problem-details, outbox, refund saga, ABAC, SLA, evidence, audit, realtime, public API) are shipped behind feature flags running in soak mode; strict-mode flips are the next ops gate.

---

## 2. The product

SportSmart is a **managed marketplace**:

| Persona | App | Capabilities |
|---|---|---|
| Customer | `web-storefront` (:4005) | Browse, search, cart, checkout (COD + online), track orders, raise returns/disputes, wallet |
| Seller | `web-d2c-seller` (:4003) | Onboard (KYC/GST/bank), list products, manage inventory, accept/fulfil orders, ship via iThink or self-delivery, view earnings, respond to returns |
| Franchise | `web-franchise` (:4004) | Geographic-territory reseller — POS, procurement, inventory, fulfil online orders |
| Affiliate | `web-affiliate` (:4007) | Referral-based commission program — share coupon codes, track earnings lifecycle, KYC, payouts |
| Super Admin | `web-admin-storefront` (:4000) | Marketplace operator — moderate catalog, verify orders, run settlements, RBAC, finance approvals |
| Seller Admin | `web-d2c-seller-admin` (:4001) | Internal seller-relations / operations staff — seller management, products, returns, accounts |
| Franchise Admin | `web-franchise-admin` (:4002) | Franchise lifecycle, KYC, pricing overrides, delivery method config |
| Affiliate Admin | `web-affiliate-admin` (:4006) | Affiliate application review, coupon issuance, payout approvals |

> **Folder ↔ role mapping:** `web-admin-storefront` (:4000) is the **Super Admin**; `web-d2c-seller-admin` (:4001) is the **Seller Admin**. The names now match the role; cross-reference by port if in doubt.

Business model differentiators:

- **Multi-seller fulfilment**: one order can split across many sellers based on stock + distance + SLA.
- **Distance-based intelligent allocation**: weighted score `0.7 × distance + 0.2 × stock + 0.1 × sla`, using India Post 165k+ pincode coordinates via Haversine.
- **Margin-based commission (Model 1)**: platform earns `platformPrice − settlementPrice` per line item; falls back to 20 % flat if seller mis-configured.
- **Admin-verified order routing**: orders pass `PENDING_VERIFICATION` → `VERIFIED` before reaching sellers, with automatic fallback reassignment on rejection.

---

## 3. Repo layout

```
SPORTSMART_OFFICIAL_MM/
├── apps/
│   ├── api/                          NestJS 11 backend           ~156k LoC
│   ├── web-admin-storefront/         Super Admin     :4000        ~46k LoC
│   ├── web-d2c-seller-admin/                    Seller Admin    :4001        ~27k LoC
│   ├── web-franchise-admin/          Franchise Admin :4002         ~9k LoC
│   ├── web-d2c-seller/                   Seller Portal   :4003        ~16k LoC
│   ├── web-franchise/                Franchise       :4004        ~19k LoC
│   ├── web-storefront/               Customer        :4005        ~17k LoC
│   ├── web-affiliate-admin/          Affiliate Admin :4006         ~6k LoC
│   └── web-affiliate/                Affiliate       :4007         ~6k LoC
├── packages/
│   ├── ui/                           @sportsmart/ui (ModalProvider + RichTextEditor, 462 LoC)
│   ├── shared-utils/                 @sportsmart/shared-utils (createApiClient factory, 243 LoC)
│   ├── tsconfig/                     @sportsmart/tsconfig (Next.js base TS config)
│   └── eslint-config/                @sportsmart/eslint-config (Next.js lint rules)
├── infra/
│   ├── docker/                       docker-compose.yml (postgres + redis), Dockerfile.api
│   ├── nginx/                        .gitkeep only (planned)
│   ├── aws/                          .gitkeep only (planned)
│   ├── ci-cd/                        .gitkeep only (planned)
│   └── scripts/                      .gitkeep only (planned)
├── docs/
│   ├── ARCHITECTURE.md               this document
│   ├── SYSTEM_DESIGN.md              81 KB long-form (2026-03-27)
│   ├── INVESTOR_SUBMISSION_PROJECT_MANAGEMENT.md
│   ├── architecture/                 module-boundaries.md, event-catalog.md, dependency-matrix.md
│   ├── decisions/                    001…020 ADRs
│   ├── flows/                        commerce-lifecycle.md (flows A–H)
│   ├── runbooks/                     ~15 cutover / incident-response runbooks
│   ├── modules/                      (empty placeholder)
│   ├── api/                          (empty placeholder)
│   ├── templates/                    issue / PR templates
│   └── plans/                        MASTER_PLAN.md, STATUS_TRACKER.md, phase-1-wire-modules/
├── .github/workflows/
│   ├── api-ci.yml                    lint + typecheck + test + e2e + build (with gitleaks)
│   └── frontend-ci.yml               8-app matrix (lint + typecheck + build, with gitleaks)
├── turbo.json                        build orchestration
├── pnpm-workspace.yaml               apps/* + packages/*
├── package.json                      root scripts (dev/build/lint/test/format → turbo)
├── tsconfig.json                     references apps/api
├── .env / .env.example
└── .dockerignore / .gitignore / .npmrc / .vscode/
```

---

## 4. Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Backend runtime | Node.js 22 (slim, digest-pinned) | Matches `Dockerfile.api` `FROM node:22-slim@sha256:…` |
| Backend framework | NestJS 11 | Modular DI; `@nestjs/schedule` for cron, `@nestjs/event-emitter` in-process |
| Backend language | TypeScript 5.6 | strict; tsc `--noEmit` is the canonical typecheck |
| ORM | Prisma 6 | **split schema** (47 `.prisma` files); generator + datasource live in `index.prisma` |
| Database | PostgreSQL 16.6 (alpine) | Logical ownership per module; physical sharing; `FOR UPDATE SKIP LOCKED` for outbox |
| Cache / locks / rate limits | Redis 7.4 (alpine) | ioredis client, fenced locks for cron, in-mem token bucket fallback for API-key rate limit |
| Validation | `class-validator` + `class-transformer` + `zod` (env) | Global `ValidationPipe` with `whitelist + forbidNonWhitelisted + transform` |
| Security | `helmet` (CSP/HSTS), `compression`, custom rate limit + brute-force | CSP tight in prod, relaxed in dev for Swagger |
| Docs | Swagger / OpenAPI (`@nestjs/swagger`) | `/api/docs` internal; `/public/v1/docs` partner (Phase 10) |
| Frontend framework | Next.js 15.5 (App Router) | All 8 web-apps; React 19.2 |
| Frontend styling | Custom CSS + (Tailwind 3 in `web-storefront` only) | No shared design system yet; `@sportsmart/ui` only exports 2 components |
| Frontend state | sessionStorage + React Context | **No Redux / Zustand / React Query.** Cart lives server-side; events bridge updates |
| Forms | Vanilla `useState` + custom validators (`src/lib/validators.ts`) | No `react-hook-form`, no `zod` on the front |
| Rich text | `react-quill-new` | Wrapped in `@sportsmart/ui/RichTextEditor` |
| Drag-and-drop | `@dnd-kit/*` | Super-admin only (menu builder, slot ordering) |
| Icons | `lucide-react` | Customer storefront only; others use inline SVG / emoji |
| HTML sanitisation | `isomorphic-dompurify` | For admin-authored product descriptions |
| Payments | Razorpay | Anti-corruption adapter at `apps/api/src/integrations/razorpay` |
| Shipping | Shiprocket + iThink | Two carriers; the adapter normalises both |
| Search | OpenSearch | Not yet in `docker-compose`; indexer + adapter shipped |
| Files | S3 + Cloudinary | S3 for evidence/long-term; Cloudinary for image transforms |
| Email | Nodemailer + SMTP (Gmail) | Templates rendered by `notifications` module |
| WhatsApp | WhatsApp Cloud API | Adapter ready, module providers register per-feature (not globally) |
| AI | Anthropic Claude + Google Gemini | Used for product-description generation, future search |
| Pkg manager | pnpm 10 | Workspace mode; `shamefully-hoist=true` |
| Monorepo | Turborepo 2 | `build` depends on `^build`; `dev` is persistent, no-cache |
| CI | GitHub Actions | api-ci + frontend-ci; gitleaks scan early; Node 22 + pnpm 10 pinned |

---

## 5. Port map

| Port | Folder | What the user calls it |
|---|---|---|
| `8000` | `apps/api` | Backend API (NestJS) |
| `4000` | `apps/web-admin-storefront` | **Super Admin** |
| `4001` | `apps/web-d2c-seller-admin` | **Seller Admin** |
| `4002` | `apps/web-franchise-admin` | Franchise Admin |
| `4003` | `apps/web-d2c-seller` | Seller Portal |
| `4004` | `apps/web-franchise` | Franchise Portal |
| `4005` | `apps/web-storefront` | Customer Storefront |
| `4006` | `apps/web-affiliate-admin` | Affiliate Admin |
| `4007` | `apps/web-affiliate` | Affiliate Portal |

Local services (`infra/docker/docker-compose.yml`):

| Port | Service |
|---|---|
| `5432` | PostgreSQL 16.6 |
| `6379` | Redis 7.4 |

---

## 6. Architectural style — strict modular monolith

ADR-001 fixes the architecture; the rules are not negotiable:

```
+-------------------+   Facade (sync)   +-------------------+
|   Module A        | ────────────────► |   Module B        |
|                   |                   |                   |
|  Controllers      |   Events (async)  |  Controllers      |
|  Services         | ──[event bus]───► |  Services         |
|  Repositories     |                   |  Repositories     |
+-------------------+                   +-------------------+
       │                                         │
       │            FORBIDDEN                    │
       └─────X─── Direct DB Access ─────X────────┘
```

1. Each module owns its data tables; **no cross-module repository access**.
2. Cross-module communication is **public facades** (sync) or **events** (async).
3. External integrations are wrapped in **anti-corruption adapters** (`apps/api/src/integrations/*` — see §19).
4. Layer direction inside a module is **presentation → application → domain**, with infrastructure ↔ domain ports — never the other way.
5. Shared code is limited to framework primitives — value objects, base entities, exception types. **Business types never live in `packages/`**.

The dependency matrix in `docs/architecture/dependency-matrix.md` is the authoritative "module A may call module B" table — `D` direct, `E` event, `R` read-only facade, `X` forbidden. Anything not in the matrix is forbidden.

---

## 7. Backend: `apps/api`

### 7.1 Bootstrap (`src/main.ts`)

The verbatim entry point (key bits annotated):

```ts
// BigInt JSON serialisation — paise columns are BigInt; default JSON.stringify
// throws. Serialise as string to keep precision (paise totals can exceed
// Number.MAX_SAFE_INTEGER for platform-level rollups).
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });
  const envService = app.get(EnvService);
  const logger = app.get(AppLoggerService);

  app.useLogger(logger);
  envService.assertProductionSecretsSafe();       // refuses to boot in prod with .env.example placeholders

  const trustProxyHops = envService.getNumber('TRUST_PROXY_HOPS', 0);
  if (trustProxyHops > 0) app.getHttpAdapter().getInstance().set('trust proxy', trustProxyHops);

  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  app.use(compression({ threshold: 1024, level: 6 }));

  const isProd = envService.isProduction();
  app.use(helmet({
    crossOriginResourcePolicy: false,
    contentSecurityPolicy: isProd ? { useDefaults: true, directives: { /* tight CSP */ } } : false,
    hsts: isProd ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    frameguard: { action: 'deny' },
    noSniff: true,
    xssFilter: true,
  }));

  app.enableCors({
    origin: envService.getCorsOrigins(),
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Idempotency-Key'],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 600,
  });

  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    stopAtFirstError: false,
    transformOptions: { enableImplicitConversion: true },
  }));

  app.useGlobalFilters(new GlobalExceptionFilter(logger, envService));
  if (!envService.isProduction()) setupSwagger(app);

  const port = envService.getNumber('PORT', 8000);
  await app.listen(port);

  // Boot banner — operators reading the log need to know which authz mode is live.
  const strict = envService.getBoolean('PERMISSIONS_GUARD_STRICT', false);
  const abac   = envService.getBoolean('ABAC_ENABLED', false);
  const audit  = envService.getBoolean('AUTHZ_AUDIT_ENABLED', true);
  logger.log(`Authorization | PERMISSIONS_GUARD_STRICT=${strict} ABAC_ENABLED=${abac} AUTHZ_AUDIT_ENABLED=${audit}`, 'Bootstrap');
}
bootstrap();
```

Takeaways:

- **HS256 JWTs**, **URI versioning** (`/api/v1/…`).
- **CORS** with explicit `X-Idempotency-Key` and `X-Request-Id` exposure.
- **`GlobalExceptionFilter`** has two emit modes — legacy `{ success, message, code, timestamp }` and RFC 7807 problem-details when `PROBLEM_DETAILS_ENABLED=true` (ADR-005). One `normalizeException` method drives both paths.
- **Boot banner** prints the three authz flag values so a grep over the deploy log answers "what mode are we in?" — ADR-019 / -020.
- **Production secret guard** (`assertProductionSecretsSafe()`) refuses to boot if any `JWT_*_SECRET` is still `replace-me-…`.

### 7.2 `AppModule` wiring

The root module imports two ordered groups: **platform** (24 modules — bootstrap, idempotency, guards, queues, retention, file integrity, erasure, cron observability, metrics, realtime, i18n, case timeline, api-keys, webhooks, sandbox, money, payments-saga, refund-instructions) and **business** (~26 domain modules — identity, seller, catalog, search, inventory, cart, wallet, support, own-brand, payments-ops, disputes, liability-ledger, reconciliation, analytics, checkout, orders, payments, cod, shipping, shipping-options, returns, settlements, affiliate, franchise, notifications, admin-control-tower, admin, admin-mfa, audit, files, commission, discounts, ai, accounts, storefront-menu, access-log, payouts, content). Only one controller registered globally: `HealthController` (`/health`, `/health/live`).

### 7.3 Module inventory (41 modules)

Total: **~1,259 files, ~91k LoC** in `apps/api/src/modules/` alone. Top by size:

| Module | Files | LoC | One-line responsibility |
|---|---:|---:|---|
| `franchise` | 143 | 14,329 | Multi-unit reseller — POS, procurement, ledger, settlement |
| `catalog` | 72 | 12,193 | Product / variant master data; seller-product mapping; allocation candidates |
| `returns` | 102 | 10,119 | RMA workflow, QC, replacement / exchange, Phase 13 |
| `discounts` | 33 | 7,557 | Coupon allocation per-order + per-item, tax-aware, redemption tracking |
| `orders` | 19 | 5,650 | Order FSM, sub-order routing, acceptance, reassignment |
| `accounts` | 13 | 3,303 | Admin / seller financial accounts; settlement aggregation |
| `seller` | 97 | 3,220 | Dashboard, storefront config, ledgers |
| `checkout` | 11 | 2,983 | Cart → order placement, addresses, payment init |
| `shipping` | 60 | 2,720 | Shiprocket / iThink integration, tracking, AWB |
| `identity` | 85 | 2,703 | User / seller / franchise onboarding, KYC |
| `notifications` | 52 | 2,369 | Event-triggered email / WhatsApp / in-app |
| `support` | 12 | 2,133 | Unified case management; timeline; evidence |
| `wallet` | 11 | 2,015 | Customer prepaid balance + transactions |
| `disputes` | 6 | 1,961 | Customer escalation; decision matrix; liability |
| `payments` | 59 | 1,926 | Razorpay; idempotency; webhook ingestion; reconciliation |
| `admin-control-tower` | 50 | 1,862 | Real-time dashboards / live metrics |
| `commission` | 9 | 1,792 | Margin-based seller earnings, reversals |
| `inventory` | 54 | 1,661 | Stock ledger; reserve / unreserve / ship / return |
| `settlements` | 60 | 1,384 | Payout calculation, debit/credit ledger |
| `reconciliation` | 7 | 1,351 | Variance detection vs gateway statements |
| `refund-instructions` | 5 | 1,200 | Unified refund executor (return/dispute/goodwill) |
| `content` | 12 | 1,232 | CMS pages, banners, menus |
| `liability-ledger` | 10 | 1,060 | SellerDebit / LogisticsClaim / PlatformExpense + AdminTask queue |
| `files` | 42 | 837 | S3 + Cloudinary uploads; signed URLs; integrity |
| `access-log` | 6 | 810 | Request audit logging |
| `audit` | 38 | 773 | Append-only audit log with chain anchors |
| `analytics` | 3 | 485 | Order/revenue/traffic dashboards |
| `affiliate` | 70 | 4,383 | Coupon-driven referral commissions |
| `admin` | 39 | 5,127 | Central admin panel, RBAC seed, dashboards |
| `admin-mfa` | — | — | TOTP enrolment + backup codes (Phase 10 deferred) |
| `cod` | 28 | 452 | Cash-on-delivery evaluation (currently stub — see §24) |
| `cod-payouts` | — | — | COD remittance batches |
| `payments-ops` | — | — | Mismatch alert resolution UI |
| `payments-saga` | — | — | Distributed refund saga (ADR-009) |
| `search` | 26 | 328 | OpenSearch full-text + facets |
| `payouts` | — | — | Seller payout history |
| `shipping-options` | — | — | Flat-fee shipping carrier config |
| `storefront-menu` | — | — | Storefront navigation builder |
| `own-brand` | — | — | Nova (own-brand) inventory + procurement |
| `ai` | — | — | Anthropic + Gemini wrappers (description generation) |

### 7.4 Layer rules

Every module follows the same DDD-flavoured Clean-Architecture layering (per ADR-001):

```
modules/<name>/
├── presentation/                 Controllers, DTOs, response shapers
│   └── controllers/
├── application/                  Use cases, services, facades, event handlers
│   ├── services/
│   ├── facades/                  the public surface other modules call
│   ├── use-cases/                command-oriented action verbs
│   └── event-handlers/
├── domain/                       Pure: entities, value objects, repo interfaces, events
│   ├── entities/
│   ├── events/
│   └── repositories/
└── infrastructure/               Adapter implementations
    ├── repositories/             Prisma implementations of domain interfaces
    └── adapters/                 thin wrappers, not core logic
```

Dependency direction: **`presentation → application → domain`**, with `infrastructure → domain` for adapter implementations.
Forbidden: `domain → infrastructure`, `domain → presentation`. The lint config doesn't enforce this yet (planned).

### 7.5 Module dependency matrix

See `docs/architecture/dependency-matrix.md` (canonical). Sample row to give the flavour — `orders` row reads:

| Depends on | D = direct facade | E = event | R = read-only | X = forbidden |
|---|---|---|---|---|
| `identity` | D | | | |
| `seller` | D | | | |
| `catalog` | D | | | |
| `inventory` | D | | | |
| `cart` | | | | X |
| `payments` | | E | | |
| `shipping` | | E | | |
| `returns` | | E | | |
| `settlements` | | E | | |
| `commission` | D | | | |
| `affiliate` | D | | | |
| `franchise` | D | | | |
| `notifications` | E | | | |
| `audit` | D | | | |

> `cart → orders` is forbidden — `checkout` is the only module allowed to call `orders.createOrderFromCheckout()`. `cart` and `checkout` are deliberately separate aggregates.

---

## 8. Data model

### 8.1 Prisma split-schema

`apps/api/prisma/schema/` holds **47 `.prisma` files**, ~6.9k schema lines. `index.prisma` is the entry point — generator + datasource only. The split mirrors module boundaries (one schema file per concept):

```
_base.prisma                  global enums (UserRole, OrderStatus, ReturnStatus, …)
index.prisma                  generator + datasource
identity.prisma               User, Role, Permission, Session, PasswordResetOtp
seller.prisma                 Seller, SellerProfile, SellerBankDetails
catalog.prisma                Product, ProductVariant, Category, Brand, Metafield
seller-product-mapping.prisma SellerProductMapping (per-seller stock + pricing + SLA)
serviceability.prisma         ServiceableArea, ServiceabilityZone
post-office.prisma            India Post pincode table (~165k rows, source for Haversine)
orders.prisma                 MasterOrder, SubOrder, OrderItem, CartItem, CustomerAddress, Cart
payments.prisma               PaymentAttempt, PaymentMismatchAlert  (observability — MasterOrder owns canonical state)
outbox.prisma                 OutboxEvent, OutboxDeadLetter, EventDeduplication
checkout / cart               (within orders.prisma)
discounts.prisma              DiscountCoupon, DiscountRule, OrderDiscount, OrderItemDiscount, …
commission.prisma             CommissionSetting, CommissionRecord, CommissionReversalRecord
returns.prisma                Return, ReturnItem, ReturnApproval, QcEvidence, RefundTransaction,
                              ReturnTaxReversalLine
disputes.prisma               Dispute, DisputeComment, DisputeAttachment
refund-instructions.prisma    RefundInstruction, RefundSaga, RefundInstructionAudit
liability-ledger.prisma       SellerDebit, LogisticsClaim, PlatformExpense, AdminTask
settlements.prisma            SettlementCycle, SellerSettlement, SettlementAdjustment
cod-payouts.prisma            CodPayout, CodPayoutRequest
wallet.prisma                 Wallet, WalletTransaction
shipping.prisma               ShippingOption
inventory                     (within catalog / seller-product-mapping)
admin.prisma                  Admin, AdminCustomRole, AdminSession, AdminMfaSecret, AdminMfaBackupCodes
authorization.prisma          ResourcePolicy, AuthorizationAudit       (ADR-010)
audit.prisma                  AuditLog, AuditChainAnchor               (ADR-013)
access-log.prisma             AccessLog
notifications.prisma          NotificationPreference, NotificationLog, NotificationTemplate,
                              NotificationSuppression                  (ADR-013 §8.2)
support.prisma                SupportTicket, TicketComment, TicketAssignment
files.prisma                  FileMetadata (with contentSha256, ADR-012)
file-url-audit.prisma         FileUrlAudit                              (ADR-012 §7.3)
retention.prisma              RetentionPolicy, RetentionExecution      (ADR-012)
data-erasure.prisma           ErasureRequest, ErasureAuditLog          (ADR-012 §7.4)
idempotency.prisma            IdempotencyKey                           (ADR-003)
case-duplicates.prisma        CaseDuplicate                            (ADR-006)
risk.prisma                   RiskScore, RiskTier                      (ADR-011)
sla.prisma                    SlaPolicy, SlaBreach                     (ADR-011)
cron-observability.prisma     CronRun, CronHeartbeatTarget             (ADR-013 §8.3)
integration-pollers.prisma    PollerObservability
i18n.prisma                   I18nMessage                              (ADR-014)
api-keys.prisma               ApiKey, ApiKeyUsage                      (ADR-015)
webhooks.prisma               WebhookEndpoint, WebhookDelivery,
                              WebhookDeliveryAttempt                   (ADR-015)
customer-abuse.prisma         CustomerAbuseMark, AbuseEscalation
content.prisma                ContentPage, ContentBlock
storefront-menu.prisma        StorefrontMenu, MenuItem
franchise.prisma              Franchise, FranchiseStaff, FranchiseLedger,
                              FranchiseSettlement, PosSale, ProcurementOrder
affiliate.prisma              Affiliate, AffiliateCommission, AffiliatePayout, AffiliateSession
own-brand.prisma              OwnBrand, OwnBrandProduct, OwnBrandInventory
reconciliation.prisma         ReconciliationCycle, ReconciliationMismatch
admin.prisma.bak              (stale backup — do not consult)
migrations/                   Prisma migrations live HERE, not at apps/api/prisma/migrations/
```

> The empty `apps/api/prisma/migrations/` directory is a minor footgun — migrations are actually under `apps/api/prisma/schema/migrations/` because of the split-schema layout. Don't re-run `prisma migrate dev` from the wrong cwd.

### 8.2 Core enums and FSMs

From `_base.prisma`:

```prisma
enum UserRole         { CUSTOMER  SELLER  SELLER_STAFF  ADMIN  SUPPORT  AFFILIATE  FRANCHISE }
enum UserStatus       { ACTIVE  INACTIVE  SUSPENDED  BANNED }
enum SellerStatus     { PENDING_APPROVAL  ACTIVE  INACTIVE  SUSPENDED  DEACTIVATED }

enum OrderStatus {
  PENDING_PAYMENT      // online order awaiting capture
  PLACED               // entry state (COD, or paid online)
  PENDING_VERIFICATION // anti-fraud gate
  VERIFIED             // passed gate, ready to route
  ROUTED_TO_SELLER     // sub-orders routed
  SELLER_ACCEPTED      // seller accepted within deadline
  DISPATCHED           // shipped
  DELIVERED            // received by customer (terminal)
  CANCELLED            // terminal
  EXCEPTION_QUEUE      // manual recovery
}

enum OrderFulfillmentStatus { UNFULFILLED PACKED SHIPPED FULFILLED DELIVERED CANCELLED }
enum OrderAcceptStatus      { OPEN ACCEPTED REJECTED CANCELLED }    // per sub-order, 24h deadline

enum ReturnStatus {
  REQUESTED  APPROVED  REJECTED  PICKUP_SCHEDULED  IN_TRANSIT  RECEIVED
  QC_APPROVED  QC_REJECTED  PARTIALLY_APPROVED
  REFUND_PROCESSING  REFUNDED  COMPLETED  CANCELLED
  // Phase 12 dispute overrides:
  DISPUTE_OVERTURNED  DISPUTE_PARTIAL_OVERRIDE  DISPUTE_CONFIRMED  GOODWILL_CREDITED
}

enum SellerResponseStatus     { NOT_REQUIRED  PENDING  ACCEPTED  CONTESTED  EXPIRED }   // Phase 13
enum ReplacementRequestStatus { NONE  PENDING_STOCK_CHECK  AWAITING_PAYMENT
                                AWAITING_FULFILMENT  FULFILLED  CANCELLED  FALLBACK_TO_REFUND }

enum LiabilityParty  { NONE  SELLER  LOGISTICS  PLATFORM  CUSTOMER  FRANCHISE  BRAND  INCONCLUSIVE }
enum CustomerRemedy  { FULL_REFUND  PARTIAL_REFUND  NO_REFUND  GOODWILL_CREDIT  REPLACEMENT  EXCHANGE }

enum DisputeStatus   { OPEN  UNDER_REVIEW  AWAITING_INFO
                       RESOLVED_BUYER  RESOLVED_SELLER  RESOLVED_SPLIT  CLOSED }

enum DeliveryMethod  { ITHINK_LOGISTICS  SELF_DELIVERY }   // Shiprocket-via-iThink, or seller-fulfilled
```

The FSM utility at `apps/api/src/core/fsm/status-transitions.ts` is the **single gate** for every status update across the codebase. Sample transitions:

```ts
const ORDER_STATUS_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  PENDING_PAYMENT:      ['PLACED', 'CANCELLED'],
  PLACED:               ['PENDING_VERIFICATION', 'VERIFIED', 'CANCELLED', 'EXCEPTION_QUEUE'],
  PENDING_VERIFICATION: ['VERIFIED', 'CANCELLED', 'EXCEPTION_QUEUE'],
  VERIFIED:             ['ROUTED_TO_SELLER', 'CANCELLED', 'EXCEPTION_QUEUE'],
  ROUTED_TO_SELLER:     ['SELLER_ACCEPTED', 'CANCELLED', 'EXCEPTION_QUEUE'],
  SELLER_ACCEPTED:      ['DISPATCHED', 'CANCELLED', 'EXCEPTION_QUEUE'],
  DISPATCHED:           ['DELIVERED', 'EXCEPTION_QUEUE'],
  DELIVERED:            [],
  CANCELLED:            [],
  EXCEPTION_QUEUE:      ['VERIFIED', 'ROUTED_TO_SELLER', 'SELLER_ACCEPTED', 'DISPATCHED', 'CANCELLED'],
};

const RETURN_STATUS_TRANSITIONS: Record<ReturnStatus, readonly ReturnStatus[]> = {
  REQUESTED:                 ['APPROVED', 'REJECTED', 'CANCELLED'],
  APPROVED:                  ['PICKUP_SCHEDULED', 'REJECTED', 'CANCELLED'],
  PICKUP_SCHEDULED:          ['IN_TRANSIT', 'RECEIVED', 'REJECTED', 'CANCELLED'],
  IN_TRANSIT:                ['RECEIVED'],
  RECEIVED:                  ['QC_APPROVED', 'QC_REJECTED', 'PARTIALLY_APPROVED'],
  QC_APPROVED:               ['REFUND_PROCESSING', 'REFUNDED'],
  PARTIALLY_APPROVED:        ['REFUND_PROCESSING', 'REFUNDED',
                              'DISPUTE_OVERTURNED', 'DISPUTE_PARTIAL_OVERRIDE'],
  QC_REJECTED:               ['COMPLETED', 'DISPUTE_OVERTURNED', 'DISPUTE_PARTIAL_OVERRIDE',
                              'DISPUTE_CONFIRMED', 'GOODWILL_CREDITED'],
  REFUND_PROCESSING:         ['REFUNDED'],
  REFUNDED:                  ['COMPLETED'],
  COMPLETED:                 ['DISPUTE_OVERTURNED', 'DISPUTE_PARTIAL_OVERRIDE'],   // post-refund correction
  REJECTED:                  [],
  CANCELLED:                 [],
  DISPUTE_OVERTURNED:        [],
  DISPUTE_PARTIAL_OVERRIDE:  [],
  DISPUTE_CONFIRMED:         [],
  GOODWILL_CREDITED:         [],
};
```

### 8.3 Order aggregate

```
MasterOrder  (one per checkout submit)
   │
   ├── orderNumber:           ORD-2026-000123 (human-readable, unique)
   ├── customerId, shippingAddressSnapshot (Json)
   ├── totalAmount (Decimal) + totalAmountInPaise (BigInt)    ← dual-write (ADR-007)
   ├── discountAmount, discountAmountInPaise
   ├── paymentMethod (COD | ONLINE), paymentStatus (PENDING|PAID|VOIDED|CANCELLED)
   ├── orderStatus (11-state FSM above)
   ├── verified, verifiedAt, verifiedBy, verificationRemarks
   ├── razorpayOrderId, razorpayPaymentId, paymentExpiresAt
   ├── shippingOptionId, shippingFeeInPaise
   │
   └── subOrders:  SubOrder[]   (one per seller / franchise)
         │
         ├── sellerId, franchiseId         (one is null)
         ├── fulfillmentNodeType           SELLER | FRANCHISE
         ├── subTotal + subTotalInPaise
         ├── paymentStatus, fulfillmentStatus, acceptStatus
         ├── acceptDeadlineAt              (usually +24h from routed)
         ├── rejectionReason
         ├── deliveryMethod                ITHINK_LOGISTICS | SELF_DELIVERY
         ├── ithinkAwb, ithinkLogistic, ithinkTrackingUrl
         ├── selfDeliveryStatus, selfDeliveredAt
         ├── commissionProcessed, commissionRateSnapshot
         ├── returnWindowEndsAt
         │
         └── items: OrderItem[]
               │
               ├── productId, variantId, sku, imageUrl
               ├── unitPrice + unitPriceInPaise
               ├── quantity, totalPrice + totalPriceInPaise
               ├── productTitle, variantTitle  (snapshot at order time)
               │
               ├── commissionRecord: CommissionRecord?   (1-to-1)
               ├── orderItemDiscounts: OrderItemDiscount[]
               ├── taxSnapshot: OrderItemTaxSnapshot?    (Phase B GST breakdown)
               └── returnItems: ReturnItem[]
```

Per-line GST snapshot (`OrderItemTaxSnapshot`) is the source of truth for tax reversal at return time — Phase B added `cgst / sgst / igst` paise columns plus `placeOfSupply` so credit notes can be issued without re-computing.

### 8.4 Money: Decimal + BigInt paise dual-write

ADR-004 introduces the `Money` value object (`apps/api/src/core/value-objects/money.ts`).
ADR-007 walks every Decimal money column through a **dual-write migration** to a sibling `*_in_paise: BigInt` column:

| Module | Columns dual-written |
|---|---|
| `returns` | `refund_amount`, `return_item.refund_amount`, `refund_transaction.amount` |
| `orders` | `master_order.total_amount`, `sub_order.sub_total`, `order_item.unit_price` + `total_price`, `discount_amount`, `shipping_fee_in_paise` |
| `settlements` | `settlement_cycle.total_amount` + `total_margin`, `seller_settlement.net_payout`, `settlement_adjustment.amount` |
| `commission` | platform_price, settlement_price, total_platform_amount, total_settlement_amount, platform_margin, original_admin_earning, max_commission_amount, …  (21 columns) |
| `cod-payouts` | `cod_decision_log.amount`, `payout.amount` |

The opt-in helper `MoneyDualWriteHelper.applyPaise(modelKey, data)` augments writes when `MONEY_DUAL_WRITE_ENABLED=true`. Reads still come from Decimal until PR 1.4b flips them. Wire format on every monetary API response is:

```json
{ "amountInPaise": 1234500, "currency": "INR", "displayInr": "₹12,345.00" }
```

Frontends never re-implement Intl.NumberFormat — they read `displayInr` directly.

Rounding is half-away-from-zero (matches Razorpay + RBI conventions and SQL `ROUND` exactly — backfill produces identical paise values to the application-side compute).

---

## 9. Authentication

### 9.1 Five JWT realms (one per actor)

The platform issues **separate JWT secrets per actor** so a token leak in one realm cannot pivot to another:

| Realm | Secret env var | Issued by | Token claims |
|---|---|---|---|
| Customer | `JWT_CUSTOMER_SECRET` | `/auth/login` | `{ userId, email, roles[] }` |
| Seller | `JWT_SELLER_SECRET` | `/seller/auth/login` | `{ sellerId, email, phoneNumber, roles[] }` |
| Franchise | `JWT_FRANCHISE_SECRET` | `/franchise/auth/login` | `{ franchiseId, code, ownerName, roles[] }` |
| Affiliate | `JWT_AFFILIATE_SECRET` | `/affiliate/auth/login` | `{ affiliateId, email, roles[] }` |
| Admin | `JWT_ADMIN_SECRET` | `/admin/auth/login` | `{ adminId, name, email, role, sessionId }` |

Plus `JWT_REFRESH_SECRET` for refresh tokens.

Algorithm: HS256. Default TTLs: access `1d` (admin tightens to `1h` once PR for ADR-020 §4 lands), refresh `30d`. The admin token's `sessionId` claim is the live revocation hook — `AdminAuthGuard` looks up `admin_sessions.revoked_at` on every request.

Brute-force protection on every login endpoint: **5 fails / 15 min lockout** + **dummy-hash timing-attack mitigation** (the unsuccessful path bcrypt-compares against a pre-generated hash so the response time matches a real failed login).

### 9.2 Token storage on the front

All eight frontends store tokens in **`sessionStorage`** with actor-specific keys to avoid collisions when two tabs are open:

| App | `accessTokenKey` | `refreshTokenKey` | `userKey` |
|---|---|---|---|
| `web-storefront` | `accessToken` | `refreshToken` | `user` |
| `web-d2c-seller` | `accessToken` | `refreshToken` | `seller` |
| `web-franchise` | `accessToken` | `refreshToken` | `franchise` |
| `web-affiliate` | `affiliateToken` | — (no refresh) | `affiliateProfile` |
| `web-admin-storefront` | `adminAccessToken` | `adminRefreshToken` | `admin` |
| `web-d2c-seller-admin` | `adminAccessToken` | `adminRefreshToken` | `admin` |
| `web-franchise-admin` | `adminAccessToken` | `adminRefreshToken` | `admin` |
| `web-affiliate-admin` | `adminToken` | — (no refresh) | `adminProfile` |

sessionStorage is intentional — tokens die when the tab closes, immune to CSRF, exposed to XSS (but XSS on a content-sanitised admin panel is game-over anyway). The XSS-vs-SSR-httpOnly-cookie trade-off is acknowledged and not on the roadmap.

### 9.3 The shared API client (`packages/shared-utils/src/api-client.ts`)

Every frontend calls `createApiClient({ accessTokenKey, refreshTokenKey, userKey, refreshPath, loginPath? })` and re-exports the result from `src/lib/api-client.ts`. The factory implements:

- **Single-flight refresh** on 401 — concurrent 401s share one refresh promise.
- **20s hard timeout on refresh** — prevents a hung `/auth/refresh` from deadlocking everything else.
- **60s default request timeout**.
- **FormData detection** — omits `Content-Type` so the browser sets the multipart boundary.
- **Response normalisation** — even non-JSON gateway HTML / timeouts surface as the typed `ApiResponse<T>` envelope.
- **Message-array flattening** — NestJS `GlobalExceptionFilter`'s legacy shape wraps `message` in an array; the client flattens it so consumers don't see `[object Object]`.
- **Token clear + redirect** on final 401 (after refresh fails).

```ts
// usage in any frontend
const cart = await apiClient<CartData>('/customer/cart');
if (cart.data) setCart(cart.data);

// on failure
catch (err) {
  if (err instanceof ApiError) {
    if (err.status === 401) router.push('/login');
    if (err.status === 422 && err.body.errors) {
      for (const e of err.body.errors) setFieldError(e.field, e.message);
    }
  }
}
```

The base URL comes from `NEXT_PUBLIC_API_URL`. In production the factory refuses to fall back to localhost; in dev it defaults to `http://localhost:8000`.

### 9.4 Affiliate referral cookie (customer storefront only)

`web-storefront`'s `middleware.ts` writes a 30-day `sm_ref` cookie when a customer lands with `?ref=AFXXXX`. The cookie is read at checkout (`POST /customer/checkout/place-order` carries `referralCode` in the body) so attribution survives tab close, return-visit, etc.

---

## 10. Authorization (RBAC + ABAC)

ADR-019 fixes the canonical mechanism: **`@Permissions('module.verb')`** is the answer for new routes. Older `@Roles(...)` exists for two narrow exceptions only.

### 10.1 Permission registry — 68 permissions

`apps/api/src/modules/admin/application/services/permission-registry.ts` is the single source of truth. A coverage test (`permission-registry.coverage.spec.ts`) fails CI if any `@Permissions('foo')` string isn't in the registry. The keys are grouped by domain:

- **orders.\*** (6) — `read | cancel | verify | reassign | mark-exception | bulk-action`
- **returns.\*** (8) — `read | approve | reject | schedulePickup | receive | uploadQcEvidence | qcDecide | overrideQc | close`
- **refunds.\*** (6) — `read | initiate | approve | confirm | retry | manualConfirm`
- **paymentOps.\*** (2), **disputes.\*** (6), **settlements.\*** (3), **payouts.\*** (3), **reconciliation.\*** (2)
- **products.\*** (3), **sellers.\*** (4), **affiliate.\*** (3), **franchise.\*** (4)
- **wallets.\*** (2), **customers.\*** (2), **analytics.\*** (1), **audit.\*** (1)
- **admin.\*** (5 — `read | create | edit | delete | reset-mfa`)
- **api-keys.\*** (2), **notifications.\*** (2), **content.\*** (3), **catalog.\*** (3)
- **support.\*** (3), **logistics.\*** (1), …

### 10.2 18 system roles + custom roles

`prisma/seed/seed-admin-rbac.ts` seeds 18 read-only system roles with `isSystem=true`:

1. Super Admin (everything)
2. Operations Manager — orders, returns, refunds, paymentOps, recon, support, audit, analytics
3. Order Executive — orders, returns, customers
4. Returns & QC Manager — returns, refunds, wallets, logistics, audit, orders
5. Catalog Manager — catalog, products, sellers, storefront
6. Seller Relation Manager — sellers, accounts, onboarding, contracts
7. Affiliate Manager — affiliates, commission, payouts, audit
8. Finance Manager — payouts, reconciliation, settlements, audit, analytics
9. Risk & Fraud Manager — risk, dispute, customers, audit
10. Support Manager — support, customers, analytics, audit
11. Compliance & Legal — audit, analytics, disputes, customers
12. Franchise Manager — franchise, inventory, procurement, settlements
13. Dispute Resolver — disputes, returns, audit, wallets
14. Admin MFA Manager — admin accounts, MFA setup, audit
15. API Key Manager — api-keys, audit
16. Notification Manager — notifications, content, audit
17. Inventory Manager — inventory, procurements, stock levels
18. Content Manager — content, storefront, catalog curation

Custom roles are created/managed at runtime via `/admin/roles`. Tables:

- `admin_custom_roles` — `(name unique, description, isSystem)`
- `admin_custom_role_permissions` — `(roleId, permissionKey)` unique pair
- `admin_role_assignments` — `(adminId, roleId)`. **No Prisma relation back to Admin** — fetch separately when listing admins.

### 10.3 Guard chain

Every admin route uses, in order:

```ts
@UseGuards(AdminAuthGuard, PermissionsGuard)              // typical
@UseGuards(AdminAuthGuard, PermissionsGuard, PolicyGuard)  // money-moving routes
@Permissions('refunds.initiate')
@Policy({ resourceType: 'refund', action: 'initiate',
          context: { amountInPaise: 'body.amountInPaise' } })
```

Layer responsibilities:

1. **`AdminAuthGuard`** — JWT valid? Session still active? Admin status `ACTIVE`? Populates `request.user.permissions` via `RoleService.resolvePermissionsForAdmin(adminId)`, which is the union of `SYSTEM_ROLE_PERMISSIONS[role]` and any custom roles assigned. (PR 4.6 was the live-incident fix for this — see runbook `rbac-incident-2026-05-11.md`.)
2. **`RolesGuard`** — legacy `@Roles('SUPER_ADMIN')` check, kept only for break-glass routes per ADR-019.
3. **`PermissionsGuard`** — the canonical layer. In soak (`PERMISSIONS_GUARD_STRICT=false`, default) it logs `event=authz.deny` and lets the request through; flip strict mode after `/admin/authz/readiness` reports zero false positives.
4. **`PolicyGuard`** — ABAC. Reads `ResourcePolicy` rows matching `(principalType, principalKey, resourceType, action)`, evaluates JSON conditions against a request-built context (`{ amountInPaise: req.body.amountInPaise }`), allows on highest-priority `ALLOW` rule, denies on any `DENY`. Operators: `$eq $ne $in $nin $lt $lte $gt $gte $exists`. **Fails closed** — unknown operator, non-numeric on numeric op, missing context all return `false`. Default-allow in soak (`ABAC_ENABLED=false`), default-deny in strict.

Every guard decision — allow or deny — is buffered and flushed to `authorization_audits` (`{ adminId, layer, decision, wouldHaveBlocked, requiredPermissions, resourceType, action, context, reason }`). One pivot table for incident response.

### 10.4 Frontend RBAC integration

**Only `web-admin-storefront` has frontend RBAC** (shipped 2026-05-04). `src/lib/permissions.tsx`:

```tsx
export function PermissionsProvider({ children }) {
  const [me, setMe] = useState<MeResponse | null>(null);
  // GET /admin/auth/me → { permissions[], isSuperAdmin, role }
  // exposes usePermissions(), hasPermission(key), hasAnyPermission(keys)
  // SUPER_ADMIN short-circuits to true on every check
}

export function RequirePermission({ anyOf, superAdminOnly, fallback, children }) {
  const { loading, isSuperAdmin, hasAnyPermission } = usePermissions();
  // resolves: allowed | denied | unknown
  // redirects to /dashboard?denied=1 on deny
}
```

The sidebar (`src/app/dashboard/layout.tsx`) declares `requires?: string[]` (any-of) or `superAdminOnly` per nav item. Items hide when permissions don't match. `/dashboard/users` and `/dashboard/roles` are both wrapped in `<RequirePermission superAdminOnly>`.

**Per-page guards on other pages are NOT yet applied uniformly.** URL-typed access to `/dashboard/orders` still works for any logged-in admin until each page is wrapped — ADR-020 §5 tracks this.

The seller admin (`web-d2c-seller-admin`), all other portals, and all customer-facing pages have **no RBAC layer** beyond authentication (the backend enforces).

---

## 11. Order lifecycle

The eight named flows in `docs/flows/commerce-lifecycle.md` (A–H) cover the canonical happy paths. Here's the order-centric thread end-to-end.

### Flow A → B: Cart → Checkout → Order

```
Customer adds item                          → cart.item.added (no consumers, audit only)
   │
   ▼
Customer hits checkout/initiate
   │  checkout.service collects:
   │   - cart snapshot (cart)
   │   - product/variant validity (catalog)
   │   - seller active/eligible status (seller)
   │   - stock validation (inventory)
   │   - COD decision (cod)        ← currently stub, see §24
   │   - pincode mapping (franchise)
   │   - affiliate attribution (affiliate)
   │  publishes: checkout.validation.passed
   │
   ▼
Customer submits checkout/place-order
   │  - inventory.reserveStock() (15-minute reservation)
   │  - orders.createOrderFromCheckout()
   │      - creates MasterOrder + SubOrders + OrderItems + line-discount snapshots
   │      - allocation: see §11.2
   │  - publishes: orders.master.created
   │                orders.sub_order.created  (one per seller/franchise)
   │  - if ONLINE → payments.createPaymentIntent()
   │  - if COD    → order paymentStatus=PENDING, paymentMethod=COD
   │  - cart cleared
```

### Flow C: Online payment

```
Razorpay webhook → POST /payments/webhooks/razorpay
   │
   ├─ HMAC-SHA256 signature check (timing-safe)
   ├─ Replay-window check on payload.created_at (±5 min)
   ├─ Idempotency claim in Redis (24h TTL)
   ├─ verify amount + currency + order match
   ├─ if mismatch: insert PaymentMismatchAlert(kind=AMOUNT_MISMATCH) row, 200 OK
   ├─ if ok: payments.payment.captured event
   │
   ▼
orders confirms paymentStatus → PAID
inventory confirm-deduct (release reservation, actual deduct)
notifications send confirmation email + WhatsApp
settlements may record initial payable basis
```

### 11.2 Allocation algorithm

`SellerAllocationService.allocate(productId, variantId?, customerPincode, quantity)`:

1. Fetch customer (lat, lon) from **`PostOffice`** table (~165k Indian pincodes, pre-loaded — `seed:pincodes`).
2. Filter `SellerProductMapping` rows where `isActive=true AND approvalStatus=APPROVED AND seller.status=ACTIVE`.
3. Filter by stock — `(stockQty - reservedQty) >= quantity`.
4. Filter by service area — `!optedInServiceAreas OR servesThisPincode`.
5. Score each candidate:
   ```
   score =   0.7 × distanceScore(haversine(seller.lat, seller.lon, customer.lat, customer.lon))
           + 0.2 × stockConfidenceScore(stockQty)
           + 0.1 × slaScore(dispatchSlaHours)
   ```
   Weights are env-tunable. `distanceScore` is monotonic-decreasing on km.
6. Return `primary | secondary | tertiary` candidates + the full eligible list.

If `primary` rejects, `OrdersService.reassignSubOrder(subOrderId, fallbackNode)` swaps the routing while preserving the customer-facing order number. Multi-seller order = one MasterOrder, N SubOrders, allocation runs independently per line where products differ.

### Flow D: Seller fulfilment

Per-sub-order acceptance FSM is independent:

```
ROUTED_TO_SELLER → OPEN (deadline +24h)
   │
   ├─ seller accepts within window         → ACCEPTED
   ├─ seller rejects (with reason)         → REJECTED  → reassign to secondary
   └─ deadline lapses (cron sweeper)        → CANCELLED → reassign
```

After `ACCEPTED`:
- Seller packs items, uploads **≥4 shipment evidence photos** (returns has the same upload-evidence pattern, ADR-012).
- Seller hits `PATCH /seller/orders/:subOrderId/fulfill` → `fulfillmentStatus PACKED → SHIPPED`.
- For `ITHINK_LOGISTICS`: AWB + tracking URL stamped on the sub-order, label PDF stored at S3.
- For `SELF_DELIVERY`: seller updates `selfDeliveryStatus` manually; `selfDeliveredAt` is the proof.

### Flow E: Tracking / NDR / RTO

```
Shiprocket webhook (HMAC-verified)
   │ shipping.normalizes external payload
   │ shipping updates SubOrder.lastTrackingEventAt (guard against out-of-order events)
   │
   ▼
events: shipping.tracking.updated, shipping.ndr.raised, shipping.rto.initiated, …
   │
   ▼
orders updates business status (ROUTED → DISPATCHED → DELIVERED)
returns module reacts on RTO
settlements records RTO adjustment
notifications send customer message
```

### Flow F → G: Returns

See §14 — returns has its own full FSM and a saga-driven refund path.

### Flow H: Settlement run (`settlement-run.service.ts`)

```
Monthly or daily cron, or admin-triggered:
1. Find all PENDING SellerDebit rows from this window
2. Find all DELIVERED + return-window-closed sub-orders
3. Compute net payable per seller:
     sum(commission.totalSettlementAmount)
   - sum(SellerDebit.amountInPaise)
   - sum(LogisticsClaim.amountInPaise where status=RECOVERED)
   - hold-back % (per-seller)
4. Create SellerSettlement rows
5. Mark linked SellerDebit rows APPLIED
6. emit settlements.run.previewed
7. Admin reviews + approves → settlements.run.approved
8. Bank transfer; on success → settlements.payout.marked_paid
```

---

## 12. Payments

### 12.1 Razorpay anti-corruption adapter

`apps/api/src/integrations/razorpay/`:

```
clients/razorpay.client.ts      HTTP client (retry + idempotency keys passthrough)
adapters/razorpay.adapter.ts    Normalised types only — NormalizedPaymentCaptureResult, NormalizedRefundResult
mappers/razorpay-payment.mapper.ts  RazorpayWebhookPayload → internal
```

No business module ever imports a `razorpay/*` type. The adapter handles BigInt-safe conversion:

```ts
private static readonly MAX_SAFE_PAISE: bigint = BigInt(Number.MAX_SAFE_INTEGER);

async createOrder(params: { amountInPaise: bigint; receipt: string; idempotencyKey?: string }) {
  if (params.amountInPaise > RazorpayAdapter.MAX_SAFE_PAISE) {
    throw new RangeError(`Exceeds safe range; split the transaction`);
  }
  const order = await this.client.createOrder({
    amount: Number(params.amountInPaise),
    receipt: params.receipt,
    idempotencyKey: params.idempotencyKey,
  });
  return { providerOrderId: order.id, amountInPaise: BigInt(order.amount), currency: order.currency };
}
```

### 12.2 Webhook ingestion

`POST /payments/webhooks/razorpay` does, in order:

1. HMAC-SHA256 signature verification (timing-safe, fail-closed on blank secret).
2. **Replay-window**: reject if payload `created_at` is outside `±5 min`.
3. **Idempotency claim**: `redis.acquireLock('webhook:razorpay:' + eventId, 24h)`. If the lock exists, the event already fired; return 200 OK.
4. Verify amount + currency + order match. On mismatch → insert `PaymentMismatchAlert(kind=AMOUNT_MISMATCH, severity=HIGH, status=OPEN)` and respond 200 OK with `code=GATEWAY_AMOUNT_MISMATCH` (PERMANENT error — Razorpay must not retry).
5. On success → publish `payments.payment.captured` event.

**Permanent vs transient error classification** is explicit:

```ts
const PERMANENT_ERROR_CODES = new Set<string>([
  'GATEWAY_PAYMENT_NOT_CAPTURED',
  'GATEWAY_ORDER_ID_MISMATCH',
  'GATEWAY_AMOUNT_MISMATCH',
  'BAD_REQUEST',
  'NOT_FOUND',
]);
```

Permanent → 200 OK + error code (so Razorpay stops retrying); transient → 500 + release Redis claim (so Razorpay retries the legitimate failure).

### 12.3 PaymentAttempt — observability layer

`payments.prisma` ships **`PaymentAttempt`** and **`PaymentMismatchAlert`** — neither holds canonical state (that lives on `MasterOrder`), they're audit + reconciliation rows:

```prisma
enum PaymentAttemptKind   { CREATE_ORDER  CAPTURE  VERIFY_SIGNATURE  REFUND }
enum PaymentAttemptStatus { SUCCESS  FAILURE }

model PaymentAttempt {
  id                String  @id @default(uuid())
  masterOrderId     String?               // null for orphans
  orderNumber       String?
  kind              PaymentAttemptKind
  status            PaymentAttemptStatus
  provider          String  @default("razorpay")
  providerOrderId   String?
  providerPaymentId String?
  providerRefundId  String?
  amountInPaise     Int?
  currency          String  @default("INR")
  responseSummary   String? @db.Text
  failureReason     String? @db.Text
  attemptNumber     Int     @default(1)
  createdAt         DateTime @default(now())

  @@index([masterOrderId, kind, createdAt(sort: Desc)])
  @@index([providerPaymentId])
  @@index([status, createdAt(sort: Desc)])
}

enum PaymentMismatchKind   { AMOUNT_MISMATCH CURRENCY_MISMATCH DUPLICATE_PAYMENT ORPHAN_PAYMENT SIGNATURE_INVALID }
enum PaymentMismatchStatus { OPEN IN_REVIEW RESOLVED IGNORED }

model PaymentMismatchAlert {
  id                String  @id @default(uuid())
  kind              PaymentMismatchKind
  status            PaymentMismatchStatus @default(OPEN)
  severity          Int     @default(50)
  masterOrderId     String?
  orderNumber       String?
  providerPaymentId String?
  expectedInPaise   BigInt?
  actualInPaise     BigInt?
  description       String  @db.Text
  resolutionNotes   String? @db.Text
  resolvedByAdminId String?
  resolvedAt        DateTime?
  createdAt         DateTime @default(now())

  @@index([status, severity(sort: Desc), createdAt(sort: Desc)])
}
```

The `/admin/payments/mismatches` queue is sorted by `severity DESC, createdAt DESC`. Finance works the top of the list.

### 12.4 Refund path — `RefundInstruction` → saga → wallet

Refunds are NOT initiated directly by `PaymentsModule`. The flow (ADR-009 + ADR-016 + ADR-017):

```
Return QC approval OR Dispute decision
       │
       ▼  RefundInstructionService.createForReturn / .createForDispute
       │   idempotencyKey = 'return:<id>' or 'dispute:<id>'  (UNIQUE)
       │   status starts at PENDING_APPROVAL or APPROVED depending on threshold
       │
       ▼  finance gate (ADR-017)
       │   amountInPaise > REFUND_AUTO_APPROVE_THRESHOLD_PAISE (default ₹10k)? → PENDING_APPROVAL
       │   customerRemedy = GOODWILL_CREDIT?                                   → PENDING_APPROVAL
       │   otherwise                                                            → PROCESSING + saga runs inline
       │
       ▼  RefundSagaService.run(steps=[walletCreditStep])
       │   persist saga row
       │   walletCreditStep:
       │     WalletPublicFacade.creditFromRefund({ refundId: instruction.id })
       │       → WalletService.credit:
       │         - findUnique on (referenceType, referenceId, type)  ← fast-path
       │         - applyMutation (UNIQUE protects against double-credit)
       │         - on P2002: look up winner, return existing  ← retry-safe
       │   on failure: compensation throws "manual review required"
       │              (intentionally not auto-reversing money)
       │
       ▼  RefundInstruction → SUCCESS  with walletTransactionId, processedAt
```

Three independent dedup checkpoints:

1. `@IdempotentHandler` on the event listener.
2. `RefundInstruction.idempotencyKey` UNIQUE.
3. `WalletTransaction (referenceType, referenceId, type)` UNIQUE.

Replays land on the existing rows; new writes never happen.

Reconciliation crons (PR 3.5):
- **Wallet-ledger drift** — daily 03:00 IST. Catches "somebody bypassed the service".
- **Refund-gateway stuck** — hourly. Catches Razorpay refunds in `PROCESSING > 24h`.
- **COD pending aged** — 4-hourly. Catches `MANUAL_REQUIRED > 48h`.

---

## 13. Commission

Model 1: **margin-based**. The platform earns `platformPrice − settlementPrice` per line; the seller is paid `settlementPrice × quantity` minus reversals.

### 13.1 CommissionRecord (commission.prisma)

One per `OrderItem` (1-to-1 via unique `orderItemId`). Created when the sub-order hits `DELIVERED` and `commissionProcessed=false`:

```prisma
enum CommissionRecordStatus { PENDING  ON_HOLD  SETTLED  REFUNDED }

model CommissionRecord {
  id            String  @id @default(uuid())
  orderItemId   String  @unique
  subOrderId    String
  masterOrderId String
  sellerId      String
  productId     String
  orderNumber   String

  // Model 1 snapshot
  platformPrice           Decimal
  platformPriceInPaise    BigInt
  settlementPrice         Decimal
  settlementPriceInPaise  BigInt
  quantity                Int
  totalPlatformAmount     Decimal
  totalPlatformAmountInPaise   BigInt
  totalSettlementAmount   Decimal
  totalSettlementAmountInPaise BigInt
  platformMargin          Decimal
  platformMarginInPaise   BigInt

  // Audit fields
  commissionRate          String                  // "Margin: 20.0%" or "Platform fee: 20% (fallback)"
  status                  CommissionRecordStatus  @default(PENDING)
  settlementId            String?                 // links to SellerSettlement batch

  // Manual adjustment
  adjustedBy              String?
  adjustedAt              DateTime?
  adjustmentReason        String?
  originalAdminEarning    Decimal?                // pre-adjustment value (audit)
  originalAdminEarningInPaise  BigInt?

  createdAt               DateTime @default(now())
  commissionReversals     CommissionReversalRecord[]

  @@index([status])
  @@index([settlementId])
  @@index([sellerId])
}

model CommissionReversalRecord {
  id                  String  @id @default(uuid())
  commissionRecordId  String
  source              CommissionReversalSource   // RETURN_QC | MANUAL
  returnId            String?
  returnNumber        String?
  reversedQty         Int
  totalRefundAmount   Decimal
  refundedAdminEarning Decimal                    // what the platform loses
  actorType           String                       // SYSTEM | ADMIN
  actorId             String?
  note                String?
  createdAt           DateTime @default(now())
}
```

### 13.2 Calculation algorithm

`CommissionProcessorService.lockSubOrderCommission(subOrder, fallbackRatePercent, reason)`:

```ts
for (const item of subOrder.items) {
  const mapping = await commissionRepo.getSellerProductMapping(
    subOrder.sellerId, item.productId, item.variantId,
  );

  const platformPrice = Number(item.unitPrice);             // customer-facing price
  let   settlementPrice = mapping?.settlementPrice
    ? Number(mapping.settlementPrice)
    : Math.round(platformPrice * 0.8 * 100) / 100;          // 80 % fallback if mapping missing

  let unitMargin = round2(platformPrice - settlementPrice);
  let usedFallbackRate = false;

  if (unitMargin <= 0) {
    // mapping has zero/negative margin → re-derive from fallback rate
    unitMargin = round2(platformPrice * (fallbackRatePercent / 100));
    settlementPrice = round2(platformPrice - unitMargin);
    usedFallbackRate = true;
  }

  records.push({
    orderItemId: item.id, subOrderId: subOrder.id, sellerId: subOrder.sellerId,
    platformPrice, settlementPrice,
    totalPlatformAmount:   round2(platformPrice   * item.quantity),
    totalSettlementAmount: round2(settlementPrice * item.quantity),
    platformMargin:        round2((platformPrice - settlementPrice) * item.quantity),
    // …+ paise variants
  });
}
```

### 13.3 Cron processor

`setInterval` every **15 seconds** with a Redis fenced lock. Finds `SubOrder` where `fulfillmentStatus=DELIVERED AND commissionProcessed=false AND deliveredAt < now - returnWindow`, locks commission, flips `commissionProcessed=true`.

Locked commission is **released** (`status=SETTLED`) only after the return window closes — until then it sits as `PENDING` (or `ON_HOLD` if a return exists).

### 13.4 Reversals

Triggered by return QC approval. The reversal is **proportional** — if 1 of 3 units returns, only 1/3 of the line's margin is reversed. The `CommissionRecord.totalSettlementAmount` is not mutated; the running sum of reversals lives on the `CommissionRecord` (computed via `commissionReversals[]`) and the settlement engine subtracts it at payout time.

---

## 14. Returns + Disputes (the 10/13-phase redesign)

This is the largest single workstream in the codebase. ADRs 003 → 015 are the original 10 phases (idempotency through public-API), and ADRs 016 → 018 are three follow-on phases (dispute liability ledger, refund finance gate, returns industry-grade). The runbook directory mirrors them: `phase-1.x-*.md` … `phase-13-*.md`.

### 14.1 Returns FSM (in three subsystems)

**Status machine** — see §8.2 for the full transition table. The states cluster into four phases:

1. **Initiation**: `REQUESTED` → `APPROVED` (auto or manual) → `REJECTED` (terminal).
2. **Pickup**: `PICKUP_SCHEDULED` → `IN_TRANSIT` → `RECEIVED`.
3. **QC**: `QC_APPROVED` | `QC_REJECTED` | `PARTIALLY_APPROVED`.
4. **Settlement**: `REFUND_PROCESSING` → `REFUNDED` → `COMPLETED`, with **dispute-override** terminal states (`DISPUTE_OVERTURNED`, `DISPUTE_PARTIAL_OVERRIDE`, `DISPUTE_CONFIRMED`, `GOODWILL_CREDITED`) for post-decision corrections.

### 14.2 Decision matrix at QC

Per ADR-018, QC submission requires an explicit (`liabilityParty` × `customerRemedy`) combination:

| `newStatus` | `customerRemedy` | Allowed `liabilityParty` |
|---|---|---|
| `QC_APPROVED` | `FULL_REFUND` | SELLER / LOGISTICS / PLATFORM / FRANCHISE / BRAND / INCONCLUSIVE / NONE |
| `QC_APPROVED` | `GOODWILL_CREDIT` | PLATFORM only (goodwill is non-recoverable) |
| `QC_APPROVED` | `REPLACEMENT` / `EXCHANGE` | any |
| `PARTIALLY_APPROVED` | `PARTIAL_REFUND` | any non-CUSTOMER |
| `QC_REJECTED` | (skipped — customer fault) | — |

`validateDecisionMatrix()` rejects forbidden combinations at the service boundary with `BadRequestAppException` — no DB write happens.

### 14.3 Seller-response lifecycle (ADR-018 P1.8)

Returns alleging seller fault (DEFECTIVE / WRONG_ITEM / NOT_AS_DESCRIBED / QUALITY_ISSUE / OTHER) auto-open a **48h seller-response window** at creation. Seller can `ACCEPT` (refund proceeds) or `CONTEST` (notes required, evidence optional). A 5-min `SellerResponseSweeperCron` flips `PENDING → EXPIRED` past due; QC defaults to seller fault if no response.

Admin can override the response window at QC time with `overrideSellerResponseWindow=true`. The override is stamped on the audit row.

### 14.4 Risk model (ADR-018 P1.11)

Rule-based 5-dimension scorer at intake (best-effort, never blocks return creation):

| Dimension | Trigger | Score |
|---|---|---|
| `CUSTOMER_ABUSE` | `CustomerAbuseCounter.requiresManualApproval` | 40 |
| `HIGH_RECENT_RETURN_COUNT` | ≥3 returns in 30 days | 15–30 (linear) |
| `HIGH_VALUE_WEAK_EVIDENCE` | ≥₹5k + 0 photos | 25 |
| `HIGH_VALUE` (alone) | ≥₹10k with photos | 10 |
| `MISSING_ITEM_CLAIM` | `WRONG_ITEM` + 0 photos | 15 |
| `CHARGEBACK_HISTORY` | any lifetime chargeback | 25 |

Routing:
- **0–29 LOW** — auto-approval rules apply.
- **30–59 MEDIUM** — auto-approval requires trusted reasons.
- **60–100 HIGH** — blocks auto-approval; admin must `acknowledgeHighRisk=true` at QC.

Risk **never causes auto-rejection** — worst case is manual review.

### 14.5 Replacement / exchange (ADR-018 P1.14)

Six paths from QC approval:

1. **Cash refund** (FULL / PARTIAL / GOODWILL) — `RefundInstructionService.createForReturn`.
2. **Replacement — same SKU** — `ReplacementOrderService` creates `MasterOrder + SubOrder + OrderItem` at ₹0, decrements `ProductVariant.stock` atomically, stamps `replacementOrderId` on the return. Order number gets `-R` suffix. No money flow.
3. **Exchange — same price** — same as replacement, different variant.
4. **Exchange — replacement cheaper** — replacement order at ₹0 + partial `RefundInstruction` for the diff (idempotency key `return:<id>:exchange-diff`).
5. **Exchange — replacement pricier** — `replacementStatus = AWAITING_PAYMENT`, `exchangePriceDiffPaise` stamped. Customer's storefront shows "Pay ₹X" CTA → Razorpay order via `/customer/returns/:id/exchange-payment-init` → verified via `/exchange-payment-verify` (HMAC-verified, constant-time, fail-closed) → replacement pipeline takes over.
6. **Out of stock** (any of 2–5) — `replacementStatus = FALLBACK_TO_REFUND`, AdminTask enqueued for finance.

### 14.6 Disputes

`disputes.prisma`:

```prisma
enum DisputeStatus  { OPEN  UNDER_REVIEW  AWAITING_INFO
                      RESOLVED_BUYER  RESOLVED_SELLER  RESOLVED_SPLIT  CLOSED }

model Dispute {
  id            String @id @default(uuid())
  disputeNumber String @unique             // DIS-2026-000001
  returnId      String?                    // disputes can be standalone (off-order) too
  customerId    String
  masterOrderId String?
  reason        String
  description   String
  initiatedBy   String @default("CUSTOMER")
  initiatorId   String?
  status        DisputeStatus @default(OPEN)
  evidenceUrls  Json?

  // Phase 12 — decision matrix (ADR-016)
  liabilityParty LiabilityParty?
  customerRemedy CustomerRemedy?

  decidedAt      DateTime?
  decidedBy      String?
  decisionReason String?
  internalNotes  String?

  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
}
```

Decision matrix mirrors §14.2 + ADR-016:

| Outcome | `customerRemedy` | `liabilityParty` | RefundInstruction | Ledger row | Linked-Return status |
|---|---|---|---|---|---|
| RESOLVED_BUYER | FULL_REFUND | SELLER | yes (full) | `SellerDebit` | `DISPUTE_OVERTURNED` |
| RESOLVED_BUYER | FULL_REFUND | LOGISTICS | yes | `LogisticsClaim` | `DISPUTE_OVERTURNED` |
| RESOLVED_BUYER | FULL_REFUND | PLATFORM | yes | `PlatformExpense (PLATFORM_FAULT)` | `DISPUTE_OVERTURNED` |
| RESOLVED_BUYER | GOODWILL_CREDIT | PLATFORM | yes | `PlatformExpense (GOODWILL)` | `GOODWILL_CREDITED` |
| RESOLVED_SPLIT | PARTIAL_REFUND | SELLER | yes (partial) | `SellerDebit (partial)` | `DISPUTE_PARTIAL_OVERRIDE` |
| RESOLVED_SELLER | NO_REFUND | CUSTOMER | no | none (commission released) | `DISPUTE_CONFIRMED` |

### 14.7 Liability ledger (ADR-016)

Three append-only tables + one ops queue:

| Table | Lifecycle | Use |
|---|---|---|
| `SellerDebit` | `PENDING → APPLIED (at settlement run) → CANCELLED` | Seller pays |
| `LogisticsClaim` | `PENDING → SUBMITTED → ACCEPTED → RECOVERED / REJECTED` | File claim with courier |
| `PlatformExpense` | `PENDING` (no state change) | Platform pays (GOODWILL / PLATFORM_FAULT / EXCEPTION / ROUNDING_ADJUSTMENT) |
| `AdminTask` | `OPEN → CLAIMED → RESOLVED / CANCELLED` | Ops queue (`REFUND_INSTRUCTION_FAILED`, `LOGISTICS_CLAIM_REVIEW`, `SELLER_DEBIT_DISPUTED`, `OTHER`) |

All three ledger tables are unique on `(sourceType, sourceId)` — saga retries hit the constraint and the service returns the existing row.

`SellerDebit` rows are settled by deducting `amountInPaise` from the seller's next payout in `settlement-run.service.ts`. The row flips `PENDING → APPLIED` and stamps `settlementId`.

### 14.8 Finance approval gate (ADR-017)

`RefundInstruction.status = PENDING_APPROVAL` is a real working state for high-value refunds:

```env
REFUND_AUTO_APPROVE_THRESHOLD_PAISE=1000000    # ₹10,000 default
REFUND_GOODWILL_REQUIRES_APPROVAL=true         # always gate goodwill
```

- `amountInPaise > threshold` → `PENDING_APPROVAL` (saga skipped).
- `customerRemedy = GOODWILL_CREDIT AND REFUND_GOODWILL_REQUIRES_APPROVAL=true` → `PENDING_APPROVAL` regardless of amount.
- otherwise → `PROCESSING` + saga inline.

Approve / reject endpoints:

| Method | Path | Permission |
|---|---|---|
| GET | `/admin/refund-instructions?status=PENDING_APPROVAL` | `refunds.approve` |
| PATCH | `/admin/refund-instructions/:id/approve` | `refunds.approve` |
| PATCH | `/admin/refund-instructions/:id/reject` (body `reason`) | `refunds.approve` |

Approve flips `PENDING_APPROVAL → PROCESSING`, stamps `approvedBy + approvedAt`, runs the saga. Idempotent (approve on `SUCCESS` is a no-op). Reject flips `→ CANCELLED` with `rejectionReason`; **the dispute decision itself is not reversed** (separate ops action).

---

## 15. Settlements

`settlements.prisma`:

```prisma
model SettlementCycle {
  id              String @id @default(uuid())
  cycleNumber     String @unique
  cycleStartDate  DateTime
  cycleEndDate    DateTime
  status          SettlementCycleStatus   // PENDING APPROVED PAID FAILED
  totalAmount         Decimal
  totalAmountInPaise  BigInt
  totalMargin         Decimal
  totalMarginInPaise  BigInt
  createdAt           DateTime @default(now())
  approvedAt          DateTime?
  completedAt         DateTime?
  sellerSettlements   SellerSettlement[]
}

model SellerSettlement {
  id                  String @id @default(uuid())
  cycleId             String
  sellerId            String
  grossSettlementInPaise   BigInt
  debitInPaise             BigInt   // sum of applied SellerDebit
  holdbackInPaise          BigInt   // per-seller %
  netPayoutInPaise         BigInt
  status                   String   // PENDING | APPROVED | PAID | FAILED
  bankRef                  String?
  approvedAt               DateTime?
  paidAt                   DateTime?
  // …
}
```

Run schedule: monthly default, configurable per-seller. Process: see §11 Flow H.

---

## 16. Cross-cutting platform

This section is the cross-cutting infrastructure layered alongside the modules. Each item maps to an ADR and a runbook.

### 16.1 Idempotency keys (ADR-003)

Routes opt in via `@Idempotent()`. Clients send `X-Idempotency-Key: <8-128 printable ASCII, typically UUIDv4>`. Storage: single Postgres table `idempotency_keys` with `(key UNIQUE, requestHash, actorType, actorId, endpoint, state, response_status, response_body, expires_at)`.

Algorithm:

1. Reject if header missing/malformed → 400.
2. INSERT `PENDING` row claiming the key.
3. On unique-constraint collision: look up the row.
   - `requestHash` mismatch → 409 "key reused with different request body".
   - `state=PENDING` → 409 "concurrent request in flight".
   - `state=COMPLETED` → return cached response.
4. On INSERT success, run handler.
5. On success → UPDATE `COMPLETED` with response (cache only `2xx` and deterministic `4xx`; never cache `5xx`).
6. On handler error → DELETE row (release the claim).
7. Sweeper cron deletes expired COMPLETED + orphan PENDING > 60 s.

Endpoints in scope today: returns/disputes creation, dispute decision, refund initiate/retry/confirm. Flag: `IDEMPOTENCY_ENABLED` (default off).

Hash function (`apps/api/src/core/idempotency/request-hash.util.ts`) takes `sha256(method | route | stable-stringified body)`. `stableStringify` sorts keys recursively so JSON object key order doesn't affect equivalence; arrays preserve order intentionally.

### 16.2 Problem Details RFC 7807 (ADR-005)

When `PROBLEM_DETAILS_ENABLED=true`, `GlobalExceptionFilter` emits `Content-Type: application/problem+json`:

```json
{
  "type":      "https://api.sportsmart.com/problems/idempotency-key-conflict",
  "title":     "Conflict",
  "status":    409,
  "detail":    "X-Idempotency-Key was reused with a different request body",
  "instance":  "/api/v1/customer/returns",
  "code":      "CONFLICT",
  "timestamp": "2026-05-05T11:23:45.000Z",
  "errors": [
    { "field": "subOrderId", "message": "subOrderId must be a UUID" }
  ]
}
```

`type` URI built from `PROBLEM_DETAILS_BASE_URI` + a slug declared in `core/filters/problem-types.ts`. Slugs are kebab-case and **never renamed** — they're the long-term partner-facing identifier.

Single `normalizeException()` method translates `HttpException`, `AppException`, Prisma errors (`P2002 → 409`, `P2025 → 404`, `P2003 → 400`), and unknowns. Both legacy and RFC 7807 emit paths read from the same `NormalizedError` struct.

### 16.3 Case-duplicate prevention (ADR-006)

Application-level check at four create entry points (idempotency keys catch *same request*; this catches *same business intent*):

| # | Rule | Active predicate | Entry point |
|---|---|---|---|
| R1 | One active return per `orderItemId` | `Return.status NOT IN (CANCELLED, REJECTED, COMPLETED, REFUNDED)` | `ReturnEligibilityService.validateReturnRequest` |
| R2 | One active dispute per `returnId` | `Dispute.status NOT IN (CLOSED, RESOLVED_*)` | `DisputeService.fileDispute` |
| R3 | One active dispute per `(masterOrderId, kind)` | same | `DisputeService.fileDispute` |
| R4 | One active ticket per `(relatedOrderId, categoryId)` | `Ticket.status NOT IN (CLOSED)` | `SupportService.createTicket` (admin can override) |

Rules centralised in `apps/api/src/core/case-duplicate/case-duplicate.service.ts`. Rejections audit to the `case_duplicates` table. Flag: `CASE_DUPLICATE_PREVENTION_ENABLED` (default off).

Known race: SELECT-then-throw window means two concurrent creates can both pass — bounded at 2, admin manually cancels duplicate. Phase 5 may add `pg_advisory_xact_lock` if needed.

### 16.4 Transactional outbox (ADR-008)

Old in-process emit was lossy on crash. New flow:

```ts
async publish(event: DomainEvent, opts?: { tx?: PrismaTx }) {
  if (this.outboxDualWrite()) {
    const db = opts?.tx ?? this.prisma;
    await db.outboxEvent.create({ data: {
      eventName: event.eventName,
      aggregate: event.aggregate,
      aggregateId: event.aggregateId,
      payload: event.payload,
      occurredAt: event.occurredAt,
    }});
  }
  if (!this.outboxAuthoritative()) {
    this.eventEmitter.emitAsync(event.eventName, event);  // legacy path
  }
}
```

If `opts.tx` is supplied AND `OUTBOX_DUAL_WRITE=true`, the outbox row commits atomically with the caller's transaction. Without `tx`, outbox failure is logged-and-swallowed (caller already committed).

Publisher worker (`OutboxPublisherService`):

```sql
WITH claim AS (
  SELECT id FROM outbox_events
   WHERE state = 'PENDING' AND next_attempt_at <= now()
   ORDER BY next_attempt_at
   LIMIT $batch_size
   FOR UPDATE SKIP LOCKED
)
UPDATE outbox_events SET next_attempt_at = $claim_window
 WHERE id IN (SELECT id FROM claim)
RETURNING *;
```

Fenced Redis lock prevents same-replica double-ticks; `FOR UPDATE SKIP LOCKED` lets multi-replica publishers claim disjoint batches without external coordination. Backoff: `1 s → 2 s → 4 s … 1 h` capped, with 0–1 s jitter. After `OUTBOX_MAX_ATTEMPTS` (10) → row moves to `outbox_dead_letters` for manual replay.

`EventDeduplication (eventId, handler)` composite-PK gives handlers idempotency: at-least-once delivery + handler-side dedup ≈ exactly-once.

Flag matrix (target steady state):

| Flag | Soak | Steady |
|---|---|---|
| `OUTBOX_ENABLED` | true | true |
| `OUTBOX_DUAL_WRITE` | true | true |
| `OUTBOX_AUTHORITATIVE` | false | true (publisher sole emitter) |
| `EVENT_DEDUP_ENABLED` | true | true |

Boot-time guard refuses to start if `OUTBOX_AUTHORITATIVE=true` without both `OUTBOX_ENABLED` and `OUTBOX_DUAL_WRITE`.

### 16.5 SLA + risk + queues (ADR-011)

Three layered tables (`sla_policies`, `sla_breaches`, `risk_scores`) + a unified queue API.

- `SlaBreachDetectorCron` (5 min cadence, idempotent upsert) flips breach rows from `OPEN → ESCALATED → RESOLVED`. Three escalation tactics: `REASSIGN_SENIOR`, `BOOST_SEVERITY`, `NOTIFY_MANAGER`.
- Risk scores compute on demand via `RiskScoreCalculator` (linear weights, hand-tuned). Reviewer-explainable ("abuser flag 30 + amount tier 40 + manual refund 15 = 85").
- `QueueService` exposes `GET /admin/queues/{return,dispute,ticket}` + `/admin/queues/summary` sorted by:
  ```sql
  ORDER BY sla_remaining_minutes ASC, risk_score DESC, created_at ASC
  ```

Flag: `SLA_BREACH_DETECTOR_ENABLED` (default off — the queue API works either way; the breach detector + escalations are gated).

### 16.6 Evidence integrity, retention, erasure (ADR-012)

- **`file_metadata.contentSha256`** computed on direct upload (≈10 ms/MB); the S3 confirm path leaves `hashedAt=NULL` and the `IntegrityVerifierCron` backfills within `INTEGRITY_VERIFIER_REVERIFY_DAYS` (default 30).
- **`retention_policies`** + **`retention_executions`** drive `RetentionEnforcerCron` (daily). `LegalHoldService` blocks on open dispute / open settlement / active return. DRY-RUN mode is the soak default.
- **`file_url_audits`** records every signed-URL fetch with per-purpose TTL caps (KYC=60s, INVOICE=120s, default=600s) and per-(file, requester) rate limit (30 / 10 min). New `TooManyRequestsAppException` → 429.
- **`data_erasure_requests`** + `ErasureService` with 24h cooldown for `USER_REQUEST`. `ErasureProcessorCron` hourly. v1 handles USER subjects only; seller/affiliate/franchise are stubbed (sub-table redaction is more complex).

`subject_email_snapshot` is the only PII retained on the erasure request row — needed to prove regulator-side which user was erased after the User row redacts to `redacted-<uuid>@erased.local`.

### 16.7 Audit anchors, notification gate, cron observability, metrics (ADR-013)

Four orthogonal additions:

- **Audit chain anchors** — `audit_chain_anchors` table + hourly cron + `/admin/audit/verify-chain-fast` (O(rows-since-anchor), not O(n)). Legacy genesis-walk endpoint retained for compliance.
- **Notification gate** — `notification_suppressions` + `NotificationGateService` with three checks in order: suppression list (hard block) → transactional bypass → user preference. Hooks left for the notifications module to call before each send.
- **Cron observability** — `cron_runs` (append-only audit, 60-day retention) + `cron_heartbeat_targets` (config, one row per `jobName`). `CronInstrumentationService.wrap(name, fn)` records start/end/duration/result/error. `CronHeartbeatCron` emits `cron.silent` when expected runs lapse beyond tolerance (default 3× expected interval).
- **Metrics** — in-process `MetricsRegistry` (counter / gauge / histogram, prom-client-shaped API, ~250 lines, no new dep). `/metrics` endpoint gated by bearer token (default empty → returns 404 so the path doesn't advertise itself).

### 16.8 Realtime + i18n + timeline (ADR-014)

- **`PortalPushService`** + `PortalStreamsController` — Server-Sent Events to scope-bound subscribers (`admin-queue`, `customer-case`, `seller-disputes`). Listens to the in-process event bus with `@OnEvent` decorators.
- **`i18n_messages`** table + `MessageCatalogueService` (60s cache + fallback `en-IN → en`) + `LocaleResolver` (override `?locale=` → user pref → Accept-Language → default). Five supported languages: en, hi, ta, kn, mr (each with `-IN` regional variant).
- **`CaseTimelineService`** joining return-status-history + dispute-messages + refund-transactions + ticket-messages. Two endpoints: `GET /portal/timeline/:caseKind/:caseId` (customer view, ABAC-enforced redaction) and `GET /admin/timeline/...` (full payload).

Redaction happens **at the join**, not at the render — internal notes never leave `CaseTimelineService` for a non-admin viewer.

### 16.9 Public API keys, webhooks, sandbox (ADR-015)

Phase 10, the final phase of the redesign:

- **API keys** — `api_keys` + `api_key_usages` tables; plaintext shown once at mint, only `sha256` hash persisted. `ApiKeyAuthGuard` validates against the hash; `ApiKeyRateLimiter` is an in-memory token bucket per key (per-pod buckets — WAF is the abuse-prevention line; this is fair-share).
- **Webhooks** — `webhook_endpoints` + `webhook_deliveries` tables; HMAC-SHA256 signing (`X-Webhook-Signature: t=<ts>,v1=<hex>`). Idempotent enqueue via UNIQUE `(endpointId, eventName, dedupeKey)`. Retry schedule: `[30s, 2m, 10m, 1h, 6h, 24h]`.
- **Sandbox** — single `environment` column on `api_keys` (`LIVE` | `TEST`). At gateway boundary the adapter branches; data plane stays identical (same DB, same FSM). A compromised LIVE key cannot pivot to TEST data.
- **Swagger split** — `/api/docs` (internal, JWT) and `/public/v1/docs` (partner, API-key). Path-prefix filtering. Partner-facing controllers must mount under `/public/v1/` AND use `@UseGuards(ApiKeyAuthGuard)`.

### 16.10 ABAC + AuthorizationAudit (ADR-010 + ADR-019)

Covered in §10. Highlights for cross-reference: `permission-registry.coverage.spec.ts` fails CI on undeclared keys; `/admin/authz/readiness` is the operator's source of truth for "are we ready to flip strict?"; SUPER_ADMIN is asserted to map to every permission by a dedicated test.

---

## 17. Background jobs

**Pattern: `setInterval` + Redis fenced locks. No BullMQ.** Not durable across restarts but the team chose simplicity over durability — outbox + idempotency catch the durability gaps where they matter. **Don't migrate to BullMQ without explicit ask** (per project memory).

Inventory of crons (approximate — most under `apps/api/src/bootstrap/scheduler/` or co-located in modules):

| Cron | Cadence | Purpose |
|---|---|---|
| `OutboxPublisherService.tick` | 1 s | Drain outbox, emit to in-process listeners |
| `IdempotencyKeySweeperCron` | 1 min | Delete expired `COMPLETED` + orphan `PENDING` > 60 s |
| `OrderTimeoutService` | 5 min | Cancel payments expired; `PENDING_PAYMENT → CANCELLED` |
| `OrderAcceptanceSlaProcessor` | 5 min | `OPEN > 24h → CANCELLED`, reassign to secondary |
| `CommissionProcessorService` | 15 s | Lock commission for newly `DELIVERED` sub-orders |
| `SlaBreachDetectorCron` | 5 min | Detect SLA breaches across returns/disputes/tickets |
| `SellerResponseSweeperCron` | 5 min | `PENDING > responseWindow → EXPIRED` |
| `IntegrityVerifierCron` | hourly | Backfill `file_metadata.contentSha256`; re-verify after 30 d |
| `RetentionEnforcerCron` | daily 02:00 IST | Apply retention policies (DRY-RUN by default) |
| `ErasureProcessorCron` | hourly | Process `USER_REQUEST` erasures after 24h cooldown |
| `AuditChainAnchorCron` | hourly | Pin new chain anchor |
| `CronHeartbeatCron` | 5 min | Emit `cron.silent` for missing expected runs |
| `WalletLedgerReconCron` | daily 03:00 IST | Wallet drift check |
| `RefundGatewayReconCron` | hourly | Stuck Razorpay refunds (PROCESSING > 24h) |
| `CodRefundPendingCron` | 4-hourly | MANUAL_REQUIRED > 48h |

Each cron name above maps to a `CronInstrumentationService.wrap(jobName, fn)` so missing runs surface via the heartbeat layer.

---

## 18. Domain events

### Naming convention

`<module>.<aggregate>.<action>` — e.g. `orders.master.created`, `payments.payment.captured`, `returns.return.qc_completed`.

### Event catalog

Canonical list in `docs/architecture/event-catalog.md`. Selected high-traffic events:

| Event | Consumers |
|---|---|
| `identity.user.registered` | notifications, audit |
| `seller.onboarding.approved` | notifications, audit, admin-control-tower |
| `catalog.listing.approved` | search, notifications, audit |
| `inventory.stock.reserved` | audit |
| `cart.checked_out` | audit |
| `checkout.validation.passed` | audit |
| `orders.master.created` | payments, settlements, notifications, audit, affiliate, franchise |
| `orders.sub_order.created` | shipping, notifications, audit |
| `orders.sub_order.delivered` | returns (eligibility window), settlements, notifications, audit |
| `payments.payment.captured` | orders, settlements, notifications, audit |
| `returns.refund.completed` | payments, settlements, notifications, audit |
| `payments.mismatch.detected` | admin-control-tower, audit *(⏳ planned — not yet emitted)* |
| `shipping.shipment.created` | orders, notifications, audit |
| `shipping.ndr.raised` | orders, notifications, audit, admin-control-tower |
| `shipping.rto.initiated` | orders, returns, settlements, notifications, audit |
| `returns.return.requested` | notifications, audit |
| `returns.return.qc_completed` | audit |
| `returns.refund.initiated` | payments, audit |
| `disputes.filed` | notifications, audit, admin-control-tower |
| `settlements.run.approved` | notifications, audit, admin-control-tower |
| `affiliate.commission.locked` | settlements, notifications, audit |
| `franchise.earning.locked` | settlements, notifications, audit |

Direct facade call vs event:

- **Direct call** when the caller needs an immediate answer and the result is part of the transaction boundary (e.g. `checkout` calling `inventory.reserveStock`).
- **Event** when the reaction can happen later and multiple consumers may react (e.g. `notifications`, `audit`, `analytics`).

---

## 19. External integrations (anti-corruption layer)

Every external service lives under `apps/api/src/integrations/<name>/` with the same three-layer structure: **clients/** (HTTP), **adapters/** (normalised types — the public surface), **mappers/** (provider payload → internal). Business modules import only from `adapters/`.

| Integration | Module owner | Normalised types |
|---|---|---|
| Razorpay | payments | `NormalizedPaymentCaptureResult`, `NormalizedRefundResult` |
| Shiprocket | shipping | `NormalizedShipmentCreateResult`, `NormalizedTrackingEvent` |
| iThink | shipping | `NormalizedShipmentResult`, `NormalizedTrackingEvent` |
| OpenSearch | search | internal search request/response contracts |
| S3 | files | `SignedUploadUrl`, `SignedDownloadUrl` |
| Cloudinary | files | image transform URLs |
| WhatsApp | notifications | `NormalizedOutboundMessage` |
| Email (SMTP) | notifications | `NormalizedOutboundMessage` |
| Anthropic Claude | ai | content-generation primitives |
| Google Gemini | ai | content-generation primitives |

Two notable gaps tracked in project memory:

- **`whatsapp.module.ts`** is essentially empty (`@Module({}) export class WhatsAppModule {}`). The adapter + client are real, but providers are registered per-feature. The affiliate module wires `WhatsAppAdapter + WhatsAppClient` directly for phone verification, with email fallback when `WHATSAPP_API_TOKEN` is absent.
- **OpenSearch is not in `docker-compose`** — local dev runs without search.

---

## 20. The eight frontends

All eight are Next.js 15 / React 19 App-Router apps that share:

- `@sportsmart/shared-utils` for the API client (§9.3)
- `@sportsmart/ui` for `ModalProvider` + `RichTextEditor` (where used)
- `@sportsmart/tsconfig/nextjs-app.json` for TS config
- `@sportsmart/eslint-config/nextjs.json` for lint rules

None of them use **Redux, Zustand, or React Query**. State lives in `sessionStorage`, in React Context (modal + super-admin permissions), or in local `useState`. No `react-hook-form` or `formik` — forms are vanilla state with hand-rolled validators in `src/lib/validators.ts`.

Six of the eight (the admin/back-office apps) use **custom CSS with CSS variables**. Only `web-storefront` uses **Tailwind 3 + PostCSS** and Google fonts (`Inter`, `Bebas Neue`, `Permanent Marker`).

### 20.1 `web-admin-storefront` — Super Admin (:4000, ~46k LoC)

- 124 files. Most feature-complete frontend.
- 47 dashboard subpages organised into sections: **Operations** (orders, products + brands/collections/category-attrs/storefront-filters, inventory), **Care** (returns, disputes, support, customers), **Finance** (refund-approvals, commission, wallets, payment-ops, reconciliation, liability-ledger), **Risk** (risk-review), **Growth** (discounts + abuse/analytics, marketing, analytics, blog-posts), **Settings** (shipping, authz-readiness, access-logs, admin-activity), **Administration** (RBAC users + roles), **NOVA** (own-brand procurement, hidden from sidebar — P1+).
- **Only frontend with RBAC integration.** `PermissionsProvider` in `dashboard/layout.tsx` fetches `/admin/auth/me`, exposes `usePermissions()`, filters sidebar items by `requires?: string[]`. `<RequirePermission anyOf|superAdminOnly>` page-level guard on `/dashboard/users` and `/dashboard/roles` only — other pages are reachable by URL for any logged-in admin (gradual rollout, ADR-020 §5).
- Drag-and-drop on menu builder (`@dnd-kit/*`) — unique to this app.
- Stubs: `/dashboard/replacements` (commented out in sidebar), Nova routes (hidden).

### 20.2 `web-d2c-seller-admin` — Seller Admin (:4001, ~27k LoC)

- 88 files. Simpler — no RBAC, no settings hub, no discounts/marketing/analytics.
- Pages: sellers, products, orders, returns, commission (+ settings), franchises (with 11 modal-driven actions), verification (+ team), accounts (+ settlements / payables / reports), procurement, inventory, storefront.
- Login form has stronger validation than the super admin (validates before submit, distinguishes 401/403).
- Confirmed TODO: `/dashboard/franchises/[id]/page.tsx` adjustment modal is placeholder.

### 20.3 `web-franchise-admin` — Franchise Admin (:4002, ~9k LoC)

- 33 files. 15 pages. 90 % production-ready.
- Master franchise list with 7 action modals (status, verification, commission, message, change-password, impersonate, delete).
- Per-franchise pricing editor, delivery methods (iThink partner code, self-delivery options), settlements ledger, cross-franchise orders aggregation.

### 20.4 `web-d2c-seller` — Seller Portal (:4003, ~16k LoC)

- 82 files. Custom CSS only (no Tailwind).
- Sidebar disables most features until seller is `ACTIVE` + email-verified.
- Product creation form (810 LoC) with **AI content generation** (`POST /ai/generate-product-content` returns description, slug, metaTitle, metaDescription).
- Orders / returns inboxes with sub-order acceptance, fulfillment evidence upload, iThink AWB display.
- "Analytics" sidebar item: `SOON` badge, disabled.

### 20.5 `web-franchise` — Franchise Portal (:4004, ~19k LoC)

- 47 files. **95 % production-ready** — most feature-complete partner portal.
- 25 dashboard pages: catalog mapping, commission rates, earnings dashboard, inventory ledger, orders + returns sub-section, **POS terminal**, **procurement workflow** (create / list / detail), profile + KYC, staff invite, support tickets.
- Business model: geographic-territory reseller. Buys wholesale via procurement, sells via POS or online, earns commission on fulfilment.

### 20.6 `web-storefront` — Customer (:4005, ~17k LoC)

- 103 files. **Tailwind 3** + custom 52KB `storefront.css` + Inter/Bebas/Permanent Marker fonts.
- Routes: `(auth)` group (login/register/forgot-password), products (PLP + PDP), cart, checkout, orders + returns tracking, account hub (profile/addresses/wallet/notifications/disputes/access-history/support), blogs, help.
- **`middleware.ts` is for affiliate-referral cookies only** — not for auth.
- PDP (658 LoC) supports multi-dimensional variants with color swatches (hex via `COLOR_MAP`) + size buttons, pincode serviceability check (`/storefront/serviceability/check`), add-to-cart with login redirect, sanitised HTML description.
- Cart persisted server-side; `cart-updated` event dispatched after mutations so header refreshes count.
- Checkout (1,369 LoC) — multi-step: address → serviceability → coupons (single per order, with rate-limit `retryAfterSeconds`) → shipping option → wallet (UI scaffold, server enforces) → place order. Carries `referralCode` from `sm_ref` cookie.
- COD only in Phase 1.

### 20.7 `web-affiliate-admin` — Affiliate Admin (:4006, ~6k LoC)

- 14 files. Applications page is feature-complete (KPI tiles, search/sort/filter, approve/reject modals, full manage modal with status/commission rate/coupon editor). Other pages (commissions, payouts, KYC, reports, settings, TDS) are stubs but settings was upgraded to "fully built" on 2026-04-29.
- Reuses general admin auth (`/admin/auth/login`), not a separate auth realm.
- Per memory: uses its own `apiFetch` instead of `createApiClient` from `shared-utils` — inconsistency.

### 20.8 `web-affiliate` — Affiliate Portal (:4007, ~6k LoC)

- 21 files. **Single-token JWT (no refresh)** by design — affiliate-portal-specific.
- 17 pages. Dashboard, earnings (with 7-state commission lifecycle: PENDING → HOLD → CONFIRMED → PAID, plus CANCELLED / REVERSED), coupons + share kit, KYC (PAN required for Section 194H, Aadhaar optional), payouts (request + history), profile, support.
- ~85 %+ complete (forgot/reset password, editable profile, phone verification all shipped).

### 20.9 Shared frontend patterns

Across all eight:

- **No global cache, no optimistic updates.** Every page fetches on mount; mutations wait for server response.
- **Hand-rolled tables.** No TanStack Table. No sorting, no virtual scrolling.
- **Modal-driven UX in admin apps** — list pages open modals for actions rather than navigating.
- **Sidebar = single source of truth for nav permissions** in super admin; nav items carry `requires?: string[]` alongside hardcoded gating.

---

## 21. Shared packages

### 21.1 `@sportsmart/ui` (462 LoC)

```ts
// packages/ui/src/index.ts
export { default as RichTextEditor } from './RichTextEditor';
export { ModalProvider, useModal } from './Modal';
```

- **`RichTextEditor`** (145 lines) — `next/dynamic` import of `react-quill-new` (SSR disabled). Toolbar: headers h1–h3, bold/italic/underline/strike, color + background, alignment, links/images, lists, blockquotes, code blocks.
- **`Modal`** (317 lines) — stack-based notification + confirmation dialogs. `useModal()` returns `notify(input)` and `confirmDialog(input)`. `notify` auto-infers kind (info/success/warning/error) from message text via regex. Keyboard: `Esc` cancels, `Enter` confirms. `z-index: 10000`.

That's the entire shared design system today. Per memory: each frontend rolls its own styles; no Tailwind sharing across apps; `@sportsmart/ui` only exports 2 components. This is intentional.

### 21.2 `@sportsmart/shared-utils` (243 LoC)

Covered in §9.3 — `createApiClient` factory, `ApiError`, `ApiResponse<T>` type.

### 21.3 `@sportsmart/tsconfig`

`nextjs-app.json` is the only shared config today. Frontends extend it; backend stands alone:

```json
{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true, "skipLibCheck": true, "strict": true, "noEmit": true,
    "esModuleInterop": true, "module": "esnext", "moduleResolution": "bundler",
    "resolveJsonModule": true, "isolatedModules": true, "jsx": "preserve",
    "incremental": true, "plugins": [{ "name": "next" }]
  }
}
```

Per-app `tsconfig.json` adds only `paths`, `include`, `exclude` (not inherited via `extends`).

### 21.4 `@sportsmart/eslint-config`

`nextjs.json` extends `next/core-web-vitals` and warn-promotes three rules (`@typescript-eslint/no-explicit-any`, `@typescript-eslint/no-unused-vars` (with `_`-prefix opt-out), `react-hooks/exhaustive-deps`). At warn so CI doesn't block; promote to error rule-by-rule.

---

## 22. Infrastructure

### 22.1 `infra/docker/docker-compose.yml`

```yaml
services:
  postgres:
    image: postgres:16.6-alpine
    ports: ["5432:5432"]
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-postgres}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-postgres}
      POSTGRES_DB: ${POSTGRES_DB:-sportsmart_dev}
    volumes: [postgres_data:/var/lib/postgresql/data]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-postgres} -d ${POSTGRES_DB:-sportsmart_dev}"]
      interval: 5s

  redis:
    image: redis:7.4-alpine
    ports: ["6379:6379"]
    volumes: [redis_data:/data]
    healthcheck: { test: ["CMD", "redis-cli", "ping"], interval: 5s }

volumes: { postgres_data:, redis_data: }
```

**OpenSearch is NOT in compose** — local dev runs without search indexing.

### 22.2 `infra/docker/Dockerfile.api`

Multi-stage; base image **pinned by SHA digest** (currently placeholder `0000…` — must be replaced with `docker inspect`-derived real digest before first prod build). Operator rotation cadence: on each Node 22.x point release.

```dockerfile
FROM node:22-slim@sha256:0000...   # placeholder
ENV PNPM_HOME="/pnpm" PATH="/pnpm:$PATH" CI=true
RUN apt-get install -y --no-install-recommends openssl ca-certificates
RUN corepack enable && corepack prepare pnpm@10.0.0 --activate

# build stage — install deps with BuildKit cache mount, prisma generate, tsc build
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @sportsmart/api...
RUN pnpm --filter @sportsmart/api exec prisma generate
RUN pnpm --filter @sportsmart/api run build
RUN pnpm deploy --filter=@sportsmart/api --prod --legacy /out

# runtime stage — non-root, healthcheck on /health/live (not /health, so DB blip doesn't kill the pod)
FROM base AS runtime
USER node
HEALTHCHECK --interval=30s ... CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/v1/health/live')...
CMD ["node", "dist/main.js"]
```

Build context **must** be the repo root (pnpm needs workspace root + lockfile):

```
docker build -f infra/docker/Dockerfile.api -t sportsmart-api:latest .
```

### 22.3 `infra/nginx`, `infra/aws`, `infra/ci-cd`, `infra/scripts`

**All `.gitkeep` only.** Planned but not yet implemented. No Terraform / CloudFormation yet. (Memory: `infra-gaps` item.)

### 22.4 CI workflows

`.github/workflows/api-ci.yml`:

```
on: pull_request | push:main, paths-filtered to apps/api + packages + lockfile
concurrency: cancel-in-progress per ref
steps:
  - checkout (fetch-depth: 0 for gitleaks)
  - gitleaks scan (early; ~5s; fails the workflow on any leak)
  - pnpm install --filter "@sportsmart/api..."
  - prisma generate + prisma validate
  - lint
  - tsc --noEmit
  - unit tests (jest)
  - e2e tests (jest with separate config; currently in-memory fakes)
  - build (nest build)
```

`.github/workflows/frontend-ci.yml`:

```
on: pull_request | push:main, paths-filtered to apps/web-* + packages + lockfile
secret-scan job (gitleaks, runs once, gates the 8-app matrix)
build matrix (8 apps, fail-fast: false):
  - install (filtered to that app + workspace deps)
  - lint
  - tsc --noEmit
  - next build
```

Node version pinned to 22, pnpm pinned to 10.0.0 — matches `Dockerfile.api`.

---

## 23. Build orchestration (Turborepo)

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "dev":    { "cache": false, "persistent": true },
    "build":  { "dependsOn": ["^build"], "outputs": [".next/**", "dist/**"] },
    "lint":   {},
    "test":   {},
    "format": {}
  }
}
```

- `pnpm dev` runs `turbo run dev` — 9 persistent processes (1 API + 8 Next.js) concurrent.
- `pnpm build` runs `turbo run build` — packages build first via `^build` dependency, then apps. Outputs are cached by content hash.
- `cache: false` on `dev` because dev is interactive; you never want a cached `dev` task.

Root `package.json` `pnpm.onlyBuiltDependencies` forces local compilation of `@nestjs/core`, Prisma client + engines, and `bcrypt` — refuses pre-built binaries because they must match the runtime libc.

---

## 24. Known gaps and ongoing work

### Phase progress (vs `docs/plans/MASTER_PLAN.md`)

The plan defined nine phases (0 → 8). Foundations + module wiring + customer journey are largely done. Phase 4 (money flows) is *the* live workstream — the 10/13 phase Returns + Disputes redesign (ADRs 003 → 018) is mid-cutover, mostly in soak mode behind flags.

### Backend gaps

- **COD `evaluate-cod.use-case.ts` returns "Not implemented".** Order routing doesn't consult it — every order falls through to the regular allocation path. Fix tracked.
- **`whatsapp.module.ts` is empty.** Adapter + client exist; providers register per-feature (affiliate verification wires them directly with email fallback).
- **Notifications use hardcoded HTML strings.** No template engine — XSS risk if data isn't escaped at the call site.
- **`@Roles`-only controllers (11 remaining)** — migration to `@Permissions` is ongoing per ADR-019. List:
  - `commission/admin-commission.controller.ts`
  - `admin-control-tower/admin-dashboard.controller.ts`
  - `settlements/admin-settlement.controller.ts`
  - `admin/admin-sellers.controller.ts`
  - `discounts/admin-discounts.controller.ts`
  - `franchise/admin-franchise-settlements.controller.ts`
  - `franchise/admin-franchise.controller.ts`
  - `accounts/accounts-settlements.controller.ts`
  - `returns/admin-returns.controller.ts`
  - `orders/admin-orders.controller.ts`
  - `shipping-options/admin-shipping-options.controller.ts`

### Frontend gaps

- **Super Admin:** Analytics page is "coming soon" placeholder. No audit-log viewer. No AI moderation dashboard. RBAC management UI shipped 2026-05-04 (just users + roles, other pages not yet gated).
- **Seller Admin / Franchise Admin:** adjustment modal has TODO comments — button placeholder, not wired.
- **Franchise Admin:** finance ledger and POS sales service methods exist; no UI.
- **Affiliate Admin:** Uses its own `apiFetch` instead of `createApiClient` — inconsistency to fix.

### Infra gaps

- `infra/{nginx,aws,scripts,ci-cd}` are `.gitkeep` only. **No Terraform/CloudFormation.**
- OpenSearch is NOT in local `docker-compose`.
- `Dockerfile.api` has placeholder digest `sha256:0000…`. Must be set before first prod build.

### Stale / weird files

- `apps/api/result.txt` (67 KB) — stale frontend-spec dump; doesn't belong in the repo.
- `apps/api/prisma/seed-metafields.ts` is duplicated at `prisma/` and `prisma/seed/`.
- `apps/api/prisma/schema/admin.prisma.bak` — backup file; do not consult.
- Migrations live under `apps/api/prisma/schema/migrations/`, not `apps/api/prisma/migrations/` (which is empty) — surprise for newcomers.

### ADR-020 deferred work

The PR 4.6 fix shipped strict-mode readiness, but six hardening items are tracked deferrals:

1. **Centralised tenant / resource scope guard** — `@ScopedResource` decorator + `ScopeGuard` to prevent silent IDORs on seller/franchise routes. ~12 days.
2. **Seller-side permissions layer** — registry stub; full layer waits on seller-staff sub-user feature.
3. **Admin MFA + step-up auth for money-moving actions** — TOTP enrolment, `@RequireMfa({ withinMinutes: 5 })` decorator. 5–7 days backend + 2 days frontend.
4. **JWT hardening** — `jti` claim, emergency blacklist, shorter admin TTL (`1h`), refresh-token rotation with reuse detection. 3 days.
5. **Admin UI permission consistency** — replace remaining `role === 'SUPER_ADMIN'` checks with `hasPermission(...)`. 1–2 days frontend.
6. **ABAC policy lifecycle (admin UI + cache invalidation)** — `AdminPolicyController` + cache pub/sub. 2 days backend + 2 days frontend.

### Architectural patterns to leave alone

Per project memory — three patterns that are deliberate even though they look like obvious migration targets:

- **`setInterval` + Redis locks** for background jobs. Not BullMQ. The team chose simplicity.
- **`sessionStorage` for JWTs** (not httpOnly cookies). Acknowledged XSS-vs-SSR-cookies trade-off.
- **No shared design system / no Tailwind across all apps.** `@sportsmart/ui` only exports 2 components, by design.

---

## 25. Where to look next

When you have a specific question:

- **"Why is X shaped this way?"** → `docs/decisions/*` (20 ADRs).
- **"How do I cut over flag X in production?"** → `docs/runbooks/*` (~15 runbooks).
- **"What event does module A emit that module B listens to?"** → `docs/architecture/event-catalog.md`.
- **"Is module A allowed to call module B?"** → `docs/architecture/dependency-matrix.md`.
- **"What does the order/return/dispute lifecycle look like?"** → `docs/flows/commerce-lifecycle.md` (the 8 flows A–H).
- **"What's the FSM transition X → Y allowed?"** → `apps/api/src/core/fsm/status-transitions.ts`.
- **"What permission do I need for endpoint Z?"** → grep for `@Permissions(` near the controller method; the registry is `apps/api/src/modules/admin/application/services/permission-registry.ts`.
- **"What's the production deploy story?"** → `infra/docker/Dockerfile.api` for the image; nginx/aws are not yet implemented.
- **"What's the data model?"** → `apps/api/prisma/schema/*.prisma` — 47 split files, start at `index.prisma` and `_base.prisma`.
- **"How does the API client refresh tokens?"** → `packages/shared-utils/src/api-client.ts`.

When you need to make a change:

- **Add a permission**: add the key to `permission-registry.ts`, re-run `pnpm seed:rbac`, add `@Permissions('module.verb')` on the controller method, add a `requires` field on the sidebar item in `web-admin-storefront/src/app/dashboard/layout.tsx` if relevant.
- **Add a domain event**: declare it in `docs/architecture/event-catalog.md`, publish via `eventBus.publish(new XxxEvent(...))`, subscribe via `@OnEvent('module.aggregate.action')`. If money-touching, thread the `tx` so the outbox row commits atomically.
- **Add a money column**: register `(model, decimalField, paiseField)` in `apps/api/src/core/money/money-field-registry.ts`. Existing callers gain dual-write when flag is on; no code changes needed at call sites unless the column is brand-new.
- **Add a new FSM state**: update `apps/api/src/core/fsm/status-transitions.ts`, update the Prisma enum, write a migration, update the `CaseDuplicateService.activeStatuses` allow-list if the new state should/shouldn't count as "active".

---

*This document is generated from a code walk on 2026-05-13. Re-generate when major modules land — particularly when the strict-mode RBAC flag flips, when COD use-case ships, or when the Phase 13 dispute liability ledger UI lands.*
