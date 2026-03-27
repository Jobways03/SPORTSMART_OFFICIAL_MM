# SPORTSMART Marketplace - System Design Document

**Version:** 1.0
**Last Updated:** 2026-03-27
**Status:** Living Document

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [System Overview & Goals](#2-system-overview--goals)
3. [Architecture Overview](#3-architecture-overview)
4. [Technology Stack](#4-technology-stack)
5. [System Context Diagram](#5-system-context-diagram)
6. [Application Architecture](#6-application-architecture)
7. [Module Design](#7-module-design)
8. [Data Architecture](#8-data-architecture)
9. [API Design](#9-api-design)
10. [Core Business Flows](#10-core-business-flows)
11. [Seller Allocation & Serviceability Engine](#11-seller-allocation--serviceability-engine)
12. [Commission & Settlement Engine](#12-commission--settlement-engine)
13. [Inventory Management System](#13-inventory-management-system)
14. [Event-Driven Architecture](#14-event-driven-architecture)
15. [Authentication & Authorization](#15-authentication--authorization)
16. [External Integrations](#16-external-integrations)
17. [Frontend Architecture](#17-frontend-architecture)
18. [Infrastructure & Deployment](#18-infrastructure--deployment)
19. [Scalability Strategy](#19-scalability-strategy)
20. [Security Design](#20-security-design)
21. [Observability & Monitoring](#21-observability--monitoring)
22. [Failure Modes & Resilience](#22-failure-modes--resilience)
23. [Future Roadmap](#23-future-roadmap)

---

## 1. Executive Summary

SPORTSMART is a **multi-seller sports marketplace** platform that connects customers with multiple independent sellers through a unified storefront. The platform handles the complete commerce lifecycle: product catalog management, intelligent seller allocation based on geographic proximity, order fulfillment orchestration across multiple sellers, margin-based commission processing, and automated settlement cycles.

**Key differentiators:**
- **Multi-seller fulfillment**: A single customer order can be split across multiple sellers based on stock availability and proximity
- **Distance-based intelligent allocation**: Haversine-formula-powered seller selection using 165K+ Indian pincode coordinates
- **Margin-based commission model**: Platform earns the spread between customer-facing price and seller settlement price
- **Admin-verified order routing**: Orders pass through admin verification before reaching sellers, with automatic fallback reallocation on seller rejection

---

## 2. System Overview & Goals

### 2.1 Business Context

SPORTSMART operates as a **managed marketplace** where:
- **Customers** browse a unified catalog, unaware of which seller fulfills their order
- **Sellers** list products, manage inventory, and fulfill orders routed to them
- **Admins** moderate the catalog, verify orders, manage settlements, and oversee operations
- **Affiliates** (future) drive traffic via referral links and earn commissions
- **Franchises** (future) operate regional fulfillment and earn service fees

### 2.2 Design Goals

| Goal | Description |
|------|-------------|
| **Modularity** | Strict bounded contexts enabling independent evolution and future microservice extraction |
| **Reliability** | Stock consistency via reservations, automatic seller fallback on rejection, audit trails |
| **Scalability** | Stateless API layer, database-level partitioning readiness, event-driven decoupling |
| **Operational Visibility** | Admin control tower with KPIs, allocation logs, reassignment history, settlement reconciliation |
| **Extensibility** | Plugin-ready for new seller types, payment providers, shipping partners, commission models |

### 2.3 Non-Functional Requirements

| Requirement | Target |
|-------------|--------|
| API Response Time (p95) | < 500ms for reads, < 2s for writes |
| Availability | 99.9% uptime |
| Concurrent Users | 10K+ simultaneous |
| Order Throughput | 1000+ orders/hour |
| Data Retention | Audit logs: 7 years, Order data: indefinite |
| Recovery Point Objective (RPO) | < 1 hour |
| Recovery Time Objective (RTO) | < 30 minutes |

---

## 3. Architecture Overview

### 3.1 Architecture Style: Strict Modular Monolith

SPORTSMART uses a **strict modular monolith** architecture (per ADR-001). This means:

- **Single deployable backend** with 23 internal business modules
- **Logical data ownership** per module within a shared PostgreSQL instance
- **Public facade interfaces** for all cross-module communication
- **Internal event bus** for async reactions (notifications, audit, analytics)
- **Anti-corruption adapters** wrapping all external integrations (per ADR-002)

```
+------------------------------------------------------------------+
|                     SPORTSMART Platform                           |
|                                                                   |
|  +------------------+  +------------------+  +------------------+ |
|  |  web-storefront  |  |   web-seller     |  |   web-admin      | |
|  |  (Next.js :3001) |  |  (Next.js :3002) |  |  (Next.js :3003) | |
|  +--------+---------+  +--------+---------+  +--------+---------+ |
|           |                      |                      |         |
|  +--------+----------+----------+----------+------------+-------+ |
|  |                     API Gateway (NestJS :4000)                | |
|  |  +----------+ +----------+ +----------+ +----------+         | |
|  |  | Identity | | Catalog  | |  Orders  | |Settlements|        | |
|  |  +----------+ +----------+ +----------+ +----------+         | |
|  |  +----------+ +----------+ +----------+ +----------+         | |
|  |  |  Seller  | |Inventory | | Checkout | |Commission |        | |
|  |  +----------+ +----------+ +----------+ +----------+         | |
|  |  +----------+ +----------+ +----------+ +----------+         | |
|  |  |   Cart   | | Payments | | Shipping | | Returns  |        | |
|  |  +----------+ +----------+ +----------+ +----------+         | |
|  |  ... + 11 more modules                                       | |
|  +--------------------------------------------------------------+ |
|           |              |              |              |          |
|  +--------+--+  +--------+--+  +--------+--+  +-------+-------+ |
|  | PostgreSQL |  |   Redis   |  |Cloudinary |  | Razorpay/etc | |
|  |   (DB)     |  |  (Cache)  |  |  (Files)  |  | (Payments)   | |
|  +------------+  +-----------+  +-----------+  +--------------+ |
+------------------------------------------------------------------+
```

### 3.2 Why Modular Monolith (Not Microservices)

| Factor | Decision |
|--------|----------|
| Team size | Small team; monolith reduces operational overhead |
| Domain maturity | Boundaries still evolving; monolith allows refactoring |
| Transaction consistency | Many flows need ACID guarantees across modules |
| Deployment simplicity | Single deployment vs. orchestrating 20+ services |
| Future migration | Module boundaries designed for clean microservice extraction |

### 3.3 Module Interaction Rules

```
+------------------+     Facade (sync)     +------------------+
|   Module A       | --------------------> |   Module B       |
|                  |                       |                  |
|  Controllers     |     Events (async)    |  Controllers     |
|  Services        | ----[event bus]-----> |  Services        |
|  Repositories    |                       |  Repositories    |
+------------------+                       +------------------+
        |                                          |
        |            FORBIDDEN                     |
        +------X--- Direct DB Access ---X----------+
```

- **D (Direct)**: Synchronous facade call (e.g., checkout calls inventory.reserveStock)
- **E (Event)**: Asynchronous event reaction (e.g., order.delivered triggers commission processing)
- **R (Read-only)**: Read-only facade access (e.g., admin-control-tower reads inventory stats)
- **X (Forbidden)**: No direct dependency allowed

---

## 4. Technology Stack

### 4.1 Backend

| Component | Technology | Version | Purpose |
|-----------|-----------|---------|---------|
| Runtime | Node.js | 20+ | Server runtime |
| Framework | NestJS | 11.0 | Modular backend framework |
| Language | TypeScript | 5.6 | Type-safe development |
| ORM | Prisma | 6.0 | Database access & migrations |
| Database | PostgreSQL | 16 | Primary data store |
| Cache | Redis | 7 | Caching, sessions, rate limiting |
| Validation | class-validator + Zod | Latest | Request/schema validation |
| Security | Helmet + Throttler | Latest | HTTP security + rate limiting |
| Docs | Swagger/OpenAPI | Latest | API documentation |

### 4.2 Frontend

| Component | Technology | Version | Purpose |
|-----------|-----------|---------|---------|
| Framework | Next.js | 15.0 | React meta-framework with SSR |
| UI Library | React | 19.0 | Component library |
| Language | TypeScript | 5.6 | Type-safe development |
| Rich Text | react-quill-new | 3.8 | WYSIWYG editor for product descriptions |
| Styling | CSS Variables | N/A | Design system with custom properties |

### 4.3 External Services

| Service | Provider | Purpose |
|---------|----------|---------|
| Payments | Razorpay | Payment capture, refunds, webhooks |
| Shipping | Shiprocket | Label generation, tracking, NDR/RTO |
| Search | OpenSearch | Full-text product search |
| File Storage | Cloudinary + AWS S3 | Image/document storage |
| Email | SMTP (Gmail) | Transactional emails |
| WhatsApp | WhatsApp Business API | Customer/seller notifications |
| AI | Anthropic Claude + Google Gemini | AI-powered features |

### 4.4 DevOps & Infrastructure

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Package Manager | pnpm | 10.0 | Fast, disk-efficient package management |
| Monorepo Tool | Turborepo | 2.0 | Build orchestration, caching |
| Containerization | Docker | Latest | Local dev + deployment |
| Orchestration | Docker Compose | Latest | Multi-service local development |

---

## 5. System Context Diagram

```
                                    +------------------+
                                    |    Customer      |
                                    | (Web Browser)    |
                                    +--------+---------+
                                             |
                              HTTPS (Port 3001)
                                             |
+------------------+            +------------+------------+            +------------------+
|    Seller        |            |                         |            |     Admin        |
| (Web Browser)    +--- :3002 --+    SPORTSMART Platform  +--- :3003 --+ (Web Browser)    |
+------------------+            |                         |            +------------------+
                                +--+------+------+-----+-+
                                   |      |      |     |
                         +---------+  +---+--+ +-+---+ +--------+
                         |           |       | |     | |        |
                   +-----+-----+ +--+----+ ++-----+ +-+------+ +--------+
                   | Razorpay  | |Shiprocket| |Cloudinary|  |OpenSearch| |WhatsApp |
                   | (Payments)| |(Shipping)| | (Files)  |  | (Search) | | (Notif) |
                   +-----------+ +---------+ +----------+  +----------+ +---------+

                   +-----------------------------------------------+
                   |              India Post Office DB              |
                   |         (165K+ pincodes with coordinates)      |
                   +-----------------------------------------------+
```

### 5.1 User Personas

| Persona | Application | Capabilities |
|---------|------------|-------------|
| **Customer** | web-storefront (:3001) | Browse, search, cart, checkout, track orders, manage returns |
| **Seller** | web-seller (:3002) | Onboard, list products, manage inventory, accept/fulfill orders, view earnings |
| **Admin** | web-admin (:3003) | Moderate catalog, verify orders, manage sellers, configure commissions, run settlements |
| **Admin (Storefront)** | web-admin-storefront (:3006) | Manage storefront products, collections, discounts, inventory |
| **Affiliate** | web-affiliate (:3004) | Generate referral links, track commissions (future) |
| **Franchise** | web-franchise (:3005) | Manage regional fulfillment, track earnings (future) |

---

## 6. Application Architecture

### 6.1 Monorepo Structure

```
sportsmart-mm/
+-- apps/
|   +-- api/                          # NestJS backend (Port 4000)
|   |   +-- prisma/
|   |   |   +-- schema/               # 19 modular Prisma schema files
|   |   |   +-- seed/                  # Seed scripts (admin, catalog, pincodes)
|   |   +-- src/
|   |       +-- bootstrap/             # Framework setup (DB, cache, security, events)
|   |       +-- integrations/          # Anti-corruption adapters
|   |       +-- modules/               # 23 business modules
|   |       +-- app.module.ts          # Root module composition
|   |       +-- main.ts                # Application entry point
|   |
|   +-- web-storefront/               # Customer app (Port 3001)
|   +-- web-seller/                   # Seller portal (Port 3002)
|   +-- web-admin/                    # Admin dashboard (Port 3003)
|   +-- web-admin-storefront/         # Admin storefront mgmt (Port 3006)
|   +-- web-affiliate/                # Affiliate portal (Port 3004) [scaffold]
|   +-- web-franchise/                # Franchise portal (Port 3005) [scaffold]
|
+-- packages/
|   +-- config/                       # Shared configuration
|   +-- shared-types/                 # Shared TypeScript interfaces
|   +-- shared-utils/                 # Shared utility functions
|   +-- ui/                           # Shared React components
|   +-- eslint-config/                # Shared ESLint rules
|   +-- tsconfig/                     # Shared TypeScript config
|
+-- infra/
|   +-- docker/                       # Docker Compose for local dev
|   +-- nginx/                        # Reverse proxy config
|   +-- aws/                          # AWS deployment config
|   +-- ci-cd/                        # CI/CD pipeline definitions
|   +-- scripts/                      # Utility scripts
|
+-- docs/                             # Architecture docs, ADRs, flows
```

### 6.2 Backend Layer Architecture (Per Module)

Each of the 23 modules follows **Clean Architecture / DDD layering**:

```
+---------------------------------------------------------------+
|                      Presentation Layer                        |
|  Controllers (REST endpoints) + DTOs (request/response shapes) |
+-------------------------------+-------------------------------+
                                |
+-------------------------------v-------------------------------+
|                      Application Layer                        |
|  Use Cases + Services + Commands/Queries + Policies            |
+-------------------------------+-------------------------------+
                                |
+-------------------------------v-------------------------------+
|                        Domain Layer                            |
|  Entities + Value Objects + Domain Rules + Domain Events        |
+-------------------------------+-------------------------------+
                                |
+-------------------------------v-------------------------------+
|                    Infrastructure Layer                        |
|  Repositories (Prisma) + External Adapters + Providers         |
+---------------------------------------------------------------+
```

**Dependency Rule:** `Presentation -> Application -> Domain <- Infrastructure`
Domain NEVER depends on infrastructure or presentation.

### 6.3 Module Composition (app.module.ts)

```
AppModule
+-- Infrastructure Modules
|   +-- EnvModule          (environment configuration)
|   +-- LoggingModule      (structured logging)
|   +-- SecurityModule     (Helmet, CORS, rate limiting)
|   +-- PrismaModule       (database connection pooling)
|   +-- RedisModule        (cache connection)
|   +-- EventsModule       (internal event bus)
|   +-- EmailModule        (SMTP transport)
|
+-- Business Modules (23)
    +-- IdentityModule     (customer auth)
    +-- SellerModule       (seller management)
    +-- CatalogModule      (products, variants, categories)
    +-- SearchModule       (OpenSearch indexing)
    +-- InventoryModule    (stock management)
    +-- CartModule         (shopping cart)
    +-- CheckoutModule     (checkout orchestration)
    +-- OrdersModule       (order lifecycle)
    +-- PaymentsModule     (payment processing)
    +-- CodModule          (cash-on-delivery rules)
    +-- ShippingModule     (shipment management)
    +-- ReturnsModule      (return handling)
    +-- SettlementsModule  (seller payouts)
    +-- AffiliateModule    (referral program)
    +-- FranchiseModule    (regional fulfillment)
    +-- NotificationsModule(email/WhatsApp dispatch)
    +-- AdminControlTowerModule (admin dashboards)
    +-- AdminModule        (admin user management)
    +-- AuditModule        (event logging)
    +-- FilesModule        (file uploads)
    +-- CommissionModule   (commission processing)
    +-- DiscountsModule    (discount management)
    +-- AiModule           (AI features)
```

---

## 7. Module Design

### 7.1 Module Dependency Matrix

This matrix defines which modules can depend on which others. Violations are architectural bugs.

```
                 identity seller catalog search inventory cart checkout orders payments cod shipping returns settlements affiliate franchise notifications admin-ctrl audit files
identity            -      X      X      X      X        X     X       X      X        X    X        X       X          X         X          E           X         D    X
seller              D      -      X      X      X        X     X       X      X        X    X        X       X          X         X          E           X         D    D
catalog             D      D      -      D      D        X     X       X      X        X    X        X       X          X         X          E           X         D    D
search              X      X      D      -      R        X     X       X      X        X    X        X       X          X         X          X           X         D    X
inventory           X      D      D      X      -        X     X       X      X        X    X        X       X          X         X          X           X         D    X
cart                D      X      D      X      D        -     X       X      X        X    X        X       X          X         X          X           X         D    X
checkout            D      D      D      X      D        D     -       D      D        D    R        X       X          D         D          E           X         D    D
orders              D      D      D      X      D        X     X       -      D        X    D        X       D          D         D          E           X         D    X
payments            X      X      X      X      X        X     X       D      -        X    X        X       D          X         X          E           X         D    X
cod                 X      X      X      X      X        X     X       X      X        -    X        X       X          X         X          X           X         D    X
shipping            X      D      X      X      X        X     X       D      X        X    -        X       X          X         X          E           X         D    X
returns             X      X      D      X      X        X     X       D      D        X    D        -       D          X         X          E           X         D    D
settlements         X      D      X      X      X        X     X       D      D        X    X        D       -          D         D          E           X         D    X
affiliate           D      X      D      X      X        X     X       D      X        X    X        X       D          -         X          E           X         D    X
franchise           X      X      X      X      X        X     X       D      X        X    X        X       D          X         -          E           X         D    X
admin-ctrl          D      D      D      X      R        X     X       D      D        D    D        D       D          D         D          E           -         D    D
```

**Legend:** D = Direct facade call | E = Event-driven | R = Read-only facade | X = Forbidden

### 7.2 Module Ownership Matrix

| Module | Owns | Does NOT Own |
|--------|------|--------------|
| **identity** | Users, auth, roles, sessions, permissions | Seller details, addresses, bank/KYC |
| **seller** | Onboarding, profile, pickup address, bank/KYC, lifecycle | Products, inventory, orders, settlements |
| **catalog** | Categories, brands, products, variants, options, moderation, seller-product-mappings, serviceability, allocation | Stock reservations, cart, checkout, search engine |
| **search** | Search API, indexing, search documents | Product truth, stock truth |
| **inventory** | Stock adjustments, low-stock tracking, imports, overview | Product definitions, cart, orders |
| **cart** | Cart state, cart lines, quantities | Checkout validation, orders, payments |
| **checkout** | Pre-order orchestration, sessions, address management | Order lifecycle, payment capture |
| **orders** | Master orders, sub-orders, lifecycle state machine, reassignment | Payment gateway, returns policy, settlements |
| **payments** | Payment attempts, capture, refunds, webhooks | Order creation, shipping |
| **cod** | COD rules, decisions, reason codes | Cart, orders, shipments |
| **shipping** | Shipments, AWB, tracking, NDR, RTO | Order creation, payments |
| **returns** | Return requests, QC, disputes, decisions | Payment execution, settlements engine |
| **settlements** | Ledger entries, payout runs, statements, reconciliation | Payment gateway, order lifecycle |
| **commission** | Commission calculation, processing, records | Settlement execution |
| **discounts** | Discount rules, codes, campaigns | Checkout price calculation |
| **notifications** | Templates, channels, dispatch | Business decisions |
| **admin-control-tower** | Dashboards, KPIs, override orchestration | Business rule ownership |
| **audit** | Audit logs, event logs, change tracking | Business state truth |
| **files** | File metadata, uploads, access policies | QC logic, onboarding |

---

## 8. Data Architecture

### 8.1 Database Strategy

- **Single PostgreSQL instance** with logical ownership per module
- **Prisma ORM** with modular schema files (19 `.prisma` files)
- **No cross-module JOINs in application code** (joins happen at the database level via Prisma relations where needed)
- **Audit trail** via AuditLog and EventLog tables

### 8.2 Entity-Relationship Overview

```
+------------------+       +------------------+       +------------------+
|      User        |       |     Seller       |       |      Admin       |
|  (Customer)      |       |  (Merchant)      |       |   (Platform)     |
+--------+---------+       +--------+---------+       +--------+---------+
         |                          |                           |
         | places                   | lists                     | manages
         v                          v                           v
+--------+---------+       +--------+---------+       +--------+---------+
|   MasterOrder    |       |     Product      |       | AdminAuditLog    |
|   (per customer) |       |  (catalog item)  |       |                  |
+--------+---------+       +--------+---------+       +------------------+
         |                          |
         | splits into              | has many
         v                          v
+--------+---------+       +--------+---------+
|    SubOrder      |       | ProductVariant   |
| (per seller)     |       | (size/color/etc) |
+--------+---------+       +--------+---------+
         |                          |
         | contains                 | linked via
         v                          v
+--------+---------+       +--------+------------------+
|    OrderItem     |       | SellerProductMapping       |
| (line item)      |       | (seller's stock per item)  |
+------------------+       +--------+------------------+
                                    |
                                    | reserves
                                    v
                           +--------+---------+
                           | StockReservation |
                           | (15-min holds)   |
                           +------------------+
```

### 8.3 Complete Data Model (58 Models, 19 Enums)

#### Enums

```
UserRole:           CUSTOMER | SELLER | SELLER_STAFF | ADMIN | SUPPORT | AFFILIATE | FRANCHISE
UserStatus:         ACTIVE | INACTIVE | SUSPENDED | BANNED
SellerStatus:       PENDING_APPROVAL | ACTIVE | INACTIVE | SUSPENDED | DEACTIVATED
ProductStatus:      DRAFT | SUBMITTED | APPROVED | REJECTED | CHANGES_REQUESTED | ACTIVE | SUSPENDED | ARCHIVED
VariantStatus:      DRAFT | ACTIVE | OUT_OF_STOCK | DISABLED | ARCHIVED
ModerationStatus:   PENDING | IN_REVIEW | APPROVED | REJECTED | CHANGES_REQUESTED
MappingApprovalStatus: PENDING_APPROVAL | APPROVED | STOPPED
OrderStatus:        PLACED | PENDING_VERIFICATION | VERIFIED | ROUTED_TO_SELLER | SELLER_ACCEPTED | DISPATCHED | DELIVERED | CANCELLED | EXCEPTION_QUEUE
OrderPaymentStatus: PENDING | PAID | VOIDED | CANCELLED
OrderFulfillmentStatus: UNFULFILLED | PACKED | SHIPPED | FULFILLED | DELIVERED | CANCELLED
OrderAcceptStatus:  OPEN | ACCEPTED | REJECTED | CANCELLED
OrderPaymentMethod: COD
AdminRole:          SUPER_ADMIN | SELLER_ADMIN | SELLER_SUPPORT | SELLER_OPERATIONS
AdminStatus:        ACTIVE | INACTIVE | SUSPENDED
SellerVerificationStatus: NOT_VERIFIED | VERIFIED | REJECTED | UNDER_REVIEW
FileClassification: PRODUCT_IMAGE | PRODUCT_DOCUMENT | KYC_DOCUMENT | QC_EVIDENCE | SELLER_LOGO | RETURN_EVIDENCE | GENERAL
CommissionType:     PERCENTAGE | FIXED | PERCENTAGE_PLUS_FIXED | FIXED_PLUS_PERCENTAGE | MARGIN_BASED
CommissionRecordStatus: PENDING | SETTLED | REFUNDED
SettlementCycleStatus: DRAFT | PREVIEWED | APPROVED | PAID
SellerSettlementStatus: PENDING | APPROVED | PAID
DiscountType:       AMOUNT_OFF_PRODUCTS | BUY_X_GET_Y | AMOUNT_OFF_ORDER | FREE_SHIPPING
DiscountMethod:     CODE | AUTOMATIC
DiscountValueType:  PERCENTAGE | FIXED_AMOUNT
DiscountStatus:     ACTIVE | SCHEDULED | EXPIRED | DRAFT
```

#### Core Models by Domain

**Identity & Auth (7 models):**
- User, Role, Permission, RolePermission, RoleAssignment, Session, PasswordResetOtp

**Seller Management (3 models):**
- Seller, SellerSession, SellerPasswordResetOtp

**Admin (5 models):**
- Admin, AdminSession, AdminActionAuditLog, AdminImpersonationLog, AdminSellerMessage

**Catalog (16 models):**
- Category (hierarchical L0/L1/L2), Brand, OptionDefinition, OptionValue, CategoryOptionTemplate
- Product, ProductOption, ProductOptionValue, ProductVariant, ProductVariantOptionValue
- ProductImage, ProductVariantImage, ProductTag, ProductSeo
- ProductCollection, ProductCollectionMap, ProductStatusHistory, ProductCodeSequence

**Orders (7 models):**
- CustomerAddress, Cart, CartItem, MasterOrder, SubOrder, OrderItem, OrderReassignmentLog, OrderSequence

**Inventory & Allocation (4 models):**
- SellerProductMapping, StockReservation, AllocationLog, SellerServiceArea

**Location (2 models):**
- PincodeDatabase (165K+ entries), PostOffice (165K+ entries)

**Commission & Settlements (4 models):**
- CommissionSetting, CommissionRecord, SettlementCycle, SellerSettlement

**Discounts (3 models):**
- Discount, DiscountProduct, DiscountCollection

**Audit (2 models):**
- AuditLog, EventLog

**Files (2 models):**
- FileMetadata, FileAttachment

### 8.4 Key Indexing Strategy

| Table | Index | Purpose |
|-------|-------|---------|
| SellerProductMapping | `(sellerId, productId, variantId)` UNIQUE | Prevent duplicate mappings |
| SellerProductMapping | `approvalStatus, isActive` | Allocation queries |
| PostOffice | `pincode, latitude` | Coordinate lookups |
| MasterOrder | `orderNumber` UNIQUE | Order lookup |
| MasterOrder | `customerId, createdAt` | Customer order history |
| SubOrder | `sellerId, fulfillmentStatus` | Seller order list |
| CommissionRecord | `orderItemId` UNIQUE | Prevent duplicate commissions |
| CommissionRecord | `status, createdAt` | Settlement cycle queries |
| Product | `slug` UNIQUE | URL-based lookup |
| Product | `status, moderationStatus` | Admin filtering |
| StockReservation | `status, expiresAt` | Expiry cleanup |

---

## 9. API Design

### 9.1 API Conventions

- **Base URL:** `/api/v1`
- **Versioning:** URI-based (default v1)
- **Format:** JSON
- **Auth:** Bearer JWT tokens
- **Pagination:** `?page=1&limit=20` (default 20, max 100)
- **Filtering:** Query parameters per endpoint
- **Sorting:** `?sortBy=createdAt&sortOrder=desc`
- **Errors:** Standard `{ success: false, message: string, errors: [] }`

### 9.2 Endpoint Map

#### Customer-Facing (Storefront)

```
Auth
  POST   /auth/register                           Register customer
  POST   /auth/login                              Login
  POST   /auth/forgot-password                    Request password reset
  POST   /auth/verify-reset-otp                   Verify OTP
  POST   /auth/reset-password                     Set new password

Storefront (Public)
  GET    /storefront/products                     Browse products (paginated, filtered)
  GET    /storefront/products/:slug               Product detail with variants
  GET    /storefront/products/search-suggestions   Search autocomplete
  GET    /storefront/collections/:slug            Collection products
  GET    /storefront/serviceability/check          Check delivery to pincode
  POST   /storefront/allocation                   Get seller allocation for item
  GET    /catalog/reference                       Categories, brands, options

Cart
  GET    /customer/cart                           Get cart
  POST   /customer/cart/items                     Add item
  PATCH  /customer/cart/items/:itemId             Update quantity
  DELETE /customer/cart/items/:itemId             Remove item
  DELETE /customer/cart                           Clear cart

Checkout
  POST   /customer/checkout/initiate              Begin checkout (allocate + reserve)
  GET    /customer/checkout/summary               Get session summary
  POST   /customer/checkout/remove-unserviceable  Remove unserviceable items
  POST   /customer/checkout/place-order           Place order

Addresses
  GET    /customer/addresses                      List addresses
  POST   /customer/addresses                      Add address
  PATCH  /customer/addresses/:id                  Update address
  DELETE /customer/addresses/:id                  Delete address

Orders
  GET    /customer/orders                         List orders
  GET    /customer/orders/:orderNumber            Order detail
  PATCH  /customer/orders/:orderNumber/cancel     Cancel order

Pincodes
  GET    /pincodes/:pincode                       Pincode lookup (city, state, places)
```

#### Seller Portal

```
Auth
  POST   /seller/register                         Register seller
  POST   /seller/login                            Login
  POST   /seller/forgot-password                  Request reset
  POST   /seller/reset-password                   Reset password

Profile
  GET    /seller/profile                          Get profile
  PATCH  /seller/profile                          Update profile
  POST   /seller/profile/media                    Upload logo/image
  DELETE /seller/profile/media/:mediaId           Delete media
  POST   /seller/email-verification/send-otp      Send verification OTP
  POST   /seller/email-verification/verify        Verify email

Products
  GET    /seller/products                         List my products
  POST   /seller/products                         Create product
  PATCH  /seller/products/:id                     Update product
  DELETE /seller/products/:id                     Delete product
  POST   /seller/products/:id/submit              Submit for review

Variants
  POST   /seller/products/:id/variants            Create variant
  PATCH  /seller/products/:id/variants/:vid       Update variant
  DELETE /seller/products/:id/variants/:vid       Delete variant

Images
  POST   /seller/products/:id/images              Upload images
  POST   /seller/products/:id/variants/:vid/images Upload variant images

Mappings (Multi-Seller Catalog)
  GET    /seller/catalog/browse                   Browse marketplace catalog
  POST   /seller/products/:id/mappings            Map to catalog product
  GET    /seller/products/:id/mappings            View my mappings

Service Areas
  GET    /seller/service-areas                    List my pincodes
  POST   /seller/service-areas                    Add pincodes
  DELETE /seller/service-areas/:pincode           Remove pincode

Orders
  GET    /seller/orders                           List my orders
  GET    /seller/orders/:subOrderId               Order detail
  PATCH  /seller/orders/:subOrderId/accept        Accept order
  PATCH  /seller/orders/:subOrderId/reject        Reject order
  PATCH  /seller/orders/:subOrderId/dispatch      Mark dispatched

Commission
  GET    /seller/commissions                      View commission records

Earnings
  GET    /seller/earnings                         Earnings summary
  GET    /seller/settlements                      Settlement history
```

#### Admin Dashboard

```
Auth
  POST   /admin/auth/login                        Admin login
  POST   /admin/auth/logout                       Logout
  GET    /admin/auth/me                           Current admin profile

Dashboard
  GET    /admin/dashboard/kpis                    Platform KPIs
  GET    /admin/dashboard/orders-overview          Orders summary
  GET    /admin/dashboard/product-performance      Top products
  GET    /admin/dashboard/seller-performance       Top sellers

Products
  GET    /admin/products                          List all products
  GET    /admin/products/:id                      Product detail
  PATCH  /admin/products/:id/approve              Approve product
  PATCH  /admin/products/:id/reject               Reject product
  PATCH  /admin/products/:id/request-changes      Request changes
  PATCH  /admin/products/:id/status               Change status

Seller Mappings
  GET    /admin/mappings/pending                  Pending mapping approvals
  PATCH  /admin/mappings/:id/approve              Approve mapping
  PATCH  /admin/mappings/:id/stop                 Stop mapping

Orders
  GET    /admin/orders                            List all orders
  GET    /admin/orders/:id                        Order detail
  POST   /admin/orders/:id/verify                 Verify & route order
  PATCH  /admin/orders/:id/reject-order           Reject & cancel order
  PATCH  /admin/orders/:id/mark-paid              Mark as paid
  GET    /admin/orders/sub-orders/:id/eligible-sellers  Get reassignment candidates
  POST   /admin/orders/sub-orders/:id/reassign    Reassign to different seller
  GET    /admin/orders/:id/reassignment-history   View reassignments

Sellers
  GET    /admin/sellers                           List sellers
  GET    /admin/sellers/:id                       Seller detail
  PATCH  /admin/sellers/:id/status                Change status
  PATCH  /admin/sellers/:id/verification          Update verification
  POST   /admin/sellers/:id/message               Send message
  PATCH  /admin/sellers/:id/password              Change password
  POST   /admin/sellers/:id/impersonate           Impersonate seller
  DELETE /admin/sellers/:id                       Delete seller

Commission
  GET    /admin/commissions                       Commission records
  GET    /admin/commission/settings               Get settings
  PUT    /admin/commission/settings               Update settings
  GET    /admin/commissions/seller-breakdown      Per-seller breakdown
  GET    /admin/commissions/margin-summary        Platform margin summary

Settlements
  GET    /admin/settlements                       List cycles
  POST   /admin/settlements                       Create cycle
  GET    /admin/settlements/:id                   Cycle detail
  POST   /admin/settlements/:id/approve           Approve cycle
  POST   /admin/settlements/:id/pay               Execute payouts
  GET    /admin/settlements/reconciliation        Reconciliation check

Inventory
  GET    /admin/inventory/overview                Inventory stats
  GET    /admin/inventory/low-stock               Low stock items
  GET    /admin/inventory/out-of-stock            Out of stock items
  GET    /admin/inventory/reservations            Active reservations

Discounts
  GET    /admin/discounts                         List discounts
  POST   /admin/discounts                         Create discount
  PATCH  /admin/discounts/:id                     Update discount
```

---

## 10. Core Business Flows

### 10.1 Customer Order Flow (End-to-End)

```
Customer                   Storefront              API                    Seller
   |                          |                     |                       |
   |-- Browse Products ------>|                     |                       |
   |                          |-- GET /storefront/products -->|             |
   |                          |<-- Product list --------|                   |
   |                          |                     |                       |
   |-- Add to Cart ---------->|                     |                       |
   |                          |-- POST /cart/items ->|                      |
   |                          |<-- Cart updated -----|                      |
   |                          |                     |                       |
   |-- Checkout ------------->|                     |                       |
   |                          |-- POST /checkout/initiate ->|              |
   |                          |                     |-- Allocate sellers    |
   |                          |                     |-- Reserve stock (15m) |
   |                          |<-- Session + summary|                      |
   |                          |                     |                       |
   |-- Place Order ---------->|                     |                       |
   |                          |-- POST /checkout/place-order ->|           |
   |                          |                     |-- Create MasterOrder  |
   |                          |                     |-- Create SubOrders    |
   |                          |                     |-- Confirm reservations|
   |                          |                     |-- Clear cart          |
   |                          |                     |-- Emit events ------->|
   |                          |<-- Order confirmed --|                      |
   |                          |                     |                       |
   |                          |                     |<-- Admin verifies ----|
   |                          |                     |-- Route to seller --->|
   |                          |                     |                       |
   |                          |                     |      Seller accepts ->|
   |                          |                     |      Seller packs  -->|
   |                          |                     |      Seller ships  -->|
   |                          |                     |                       |
   |<-- Delivery -------------|<-- Status updates --|<-- Delivered ---------|
   |                          |                     |                       |
   |                          |                     |-- Return window ends  |
   |                          |                     |-- Process commission  |
   |                          |                     |-- Create settlement   |
```

### 10.2 Order State Machine

```
                                    +--------+
                                    | PLACED |
                                    +---+----+
                                        |
                                  Admin verifies
                                        |
                              +---------v---------+
                              | PENDING_VERIFICATION|
                              +---------+---------+
                                        |
                            +-----------+-----------+
                            |                       |
                       Serviceable            Not serviceable
                            |                       |
                    +-------v-------+       +-------v--------+
                    |   VERIFIED    |       | EXCEPTION_QUEUE|
                    +-------+-------+       +----------------+
                            |                    ^
                      Route to seller            | (if reallocation fails)
                            |                    |
                    +-------v-----------+        |
                    | ROUTED_TO_SELLER  +--------+
                    +-------+-----------+
                            |
                   +--------+--------+
                   |                 |
              Seller accepts    Seller rejects
                   |                 |
           +-------v-------+   Reallocate or
           |SELLER_ACCEPTED|   EXCEPTION_QUEUE
           +-------+-------+
                   |
              +----+----+
              |         |
           Packed    (skip)
              |         |
        +-----v-----+  |
        |  PACKED    |  |
        +-----+-----+  |
              |         |
           Shipped      |
              |         |
        +-----v------+  |
        | DISPATCHED  +--+
        +-----+------+
              |
           Delivered
              |
        +-----v------+
        | DELIVERED   |
        +-----+------+
              |
        Return window (configurable)
              |
        Commission processed
              |
        Settlement cycle
```

### 10.3 Product Moderation Flow

```
Seller                      Admin                     System
  |                           |                         |
  |-- Create Product -------->|                         |
  |   (status: DRAFT)        |                         |
  |                           |                         |
  |-- Submit for Review ----->|                         |
  |   (status: SUBMITTED)    |                         |
  |                           |-- Duplicate detection -->|
  |                           |<-- Similarity scores ---|
  |                           |                         |
  |              +------------+------------+            |
  |              |            |            |            |
  |           Approve    Request Changes  Reject       |
  |              |            |            |            |
  |   (APPROVED) |  (CHANGES  |  (REJECTED)|            |
  |              |  REQUESTED)|            |            |
  |              |            |            |            |
  |              v            v            |            |
  |        Auto-activate   Seller edits   |            |
  |       (status: ACTIVE)  & resubmits   |            |
  |              |            |            |            |
  |              v            +-------->---+            |
  |        Live on storefront                          |
```

### 10.4 Seller Rejection & Reallocation Flow

```
Sub-Order (ROUTED_TO_SELLER)
         |
    Seller rejects (with reason)
         |
    +----v----+
    | Release  |  Restore stock for rejected seller's reservations
    | Stock    |
    +----+----+
         |
    +----v-----------+
    | Find Eligible   |  Exclude: rejected seller + all previously rejected
    | Sellers         |  Filter: APPROVED mapping + available stock + active seller
    +----+-----------+
         |
    +----+----+----+
    |              |
  Found         Not Found
    |              |
    v              v
+---+-------+  +--+----------------+
| Allocate  |  | EXCEPTION_QUEUE   |
| New Seller|  | (Manual admin     |
+---+-------+  |  intervention)    |
    |          +-------------------+
    v
+---+------------------+
| Create NEW SubOrder  |  New sub-order for new seller
| Reserve Stock        |  24-hour accept deadline
| Log Reassignment     |  OrderReassignmentLog + AllocationLog
| Notify New Seller    |  Email notification
+----------------------+
```

---

## 11. Seller Allocation & Serviceability Engine

### 11.1 Allocation Algorithm

The allocation engine is the core differentiator of the platform. It determines which seller fulfills each item in an order.

```
Input: { productId, variantId?, customerPincode, quantity }
                    |
                    v
    +-------------------------------+
    | 1. Lookup Customer Coordinates |
    |    PostOffice table by pincode |
    |    (165K+ entries with lat/lng)|
    +---------------+---------------+
                    |
                    v
    +-------------------------------+
    | 2. Find Eligible Sellers       |
    |    - SellerProductMapping      |
    |    - approvalStatus = APPROVED |
    |    - isActive = true           |
    |    - Seller.status = ACTIVE    |
    |    - availableStock >= qty     |
    |    - Exclude: failed mappings  |
    +---------------+---------------+
                    |
                    v
    +-------------------------------+
    | 3. Calculate Distance          |
    |    Haversine formula:          |
    |    d = 2R * arcsin(sqrt(       |
    |      sin^2((lat2-lat1)/2) +    |
    |      cos(lat1)*cos(lat2)*      |
    |      sin^2((lng2-lng1)/2)      |
    |    ))                          |
    |    R = 6371 km (Earth radius)  |
    +---------------+---------------+
                    |
                    v
    +-------------------------------+
    | 4. Score & Rank                |
    |    score = 100% distance weight|
    |    Sort: ASC by distance       |
    |    (null coords = 999km)       |
    +---------------+---------------+
                    |
                    v
    +-------------------------------+
    | 5. Select Top 3                |
    |    Primary   (rank #1)         |
    |    Secondary (rank #2)         |
    |    Tertiary  (rank #3)         |
    +---------------+---------------+
                    |
                    v
    +-------------------------------+
    | 6. Estimate Delivery           |
    |    dispatchSLA + transitDays   |
    |    Transit: distance-based     |
    |    0-50km:   1 day             |
    |    50-200km: 2 days            |
    |    200-500km: 3 days           |
    |    500km+:   4 days            |
    +---------------+---------------+
                    |
                    v
    +-------------------------------+
    | 7. Log Allocation              |
    |    AllocationLog table         |
    |    (full audit trail)          |
    +-------------------------------+

Output: {
  serviceable: true,
  primarySeller: { id, distance, score, deliveryEstimate },
  secondarySeller: { ... },
  tertiarySeller: { ... },
  allEligible: [ ... ]
}
```

### 11.2 Stock Reservation Lifecycle

```
                 +------------+
                 | AVAILABLE  |  stockQty - reservedQty > 0
                 +-----+------+
                       |
                  Reserve (checkout initiate)
                  reservedQty += quantity
                       |
                 +-----v------+
                 |  RESERVED   |  15-minute TTL
                 +--+------+--+
                    |      |
              +-----+      +-------+
              |                     |
         Order placed         Timer expires (60s cleanup)
         Confirm reservation  reservedQty -= quantity
         stockQty -= quantity  status = EXPIRED
         reservedQty -= quantity
              |                     |
        +-----v------+       +-----v------+
        | CONFIRMED  |       |  EXPIRED   |
        +------------+       +------------+
              |
         Order cancelled
         stockQty += quantity
              |
        +-----v------+
        |  RELEASED  |
        +------------+
```

### 11.3 Serviceability Check

```
GET /storefront/serviceability/check?productId=X&pincode=123456&variantId=Y

    +-------------------+
    | Find active seller|  SellerProductMapping
    | mappings for      |  WHERE approvalStatus = APPROVED
    | product/variant   |  AND isActive = true
    +--------+----------+  AND seller.status = ACTIVE
             |             AND (stockQty - reservedQty) > 0
             v
    +-------------------+
    | Calculate distance|  For each eligible seller
    | from customer     |  Using PostOffice coordinates
    | pincode           |
    +--------+----------+
             |
             v
    +-------------------+
    | Sort by distance  |
    | Estimate delivery |
    +--------+----------+
             |
             v
    Response: {
      serviceable: true,
      sellers: [ { sellerId, distance, deliveryEstimate } ],
      bestDelivery: "Delivery by tomorrow"
    }
```

---

## 12. Commission & Settlement Engine

### 12.1 Commission Model (Margin-Based / Model 1)

The platform earns revenue through the **price spread** between what the customer pays (platform price) and what the seller receives (settlement price).

```
+------------------------------------------------------------------+
|                    Commission Calculation                          |
|                                                                   |
|  platformPrice = OrderItem.unitPrice  (what customer pays)        |
|  settlementPrice = SellerProductMapping.settlementPrice            |
|                    (what seller receives per unit)                 |
|                                                                   |
|  unitMargin = platformPrice - settlementPrice                     |
|                                                                   |
|  For each OrderItem:                                              |
|    totalPlatformAmount  = platformPrice x quantity                 |
|    totalSettlementAmount = settlementPrice x quantity              |
|    platformMargin       = totalPlatformAmount - totalSettlementAmount |
|                                                                   |
|  Example:                                                         |
|    Customer pays:  Rs 1,000 x 2 = Rs 2,000                       |
|    Seller receives: Rs 800  x 2 = Rs 1,600                       |
|    Platform margin:              = Rs 400                          |
+------------------------------------------------------------------+
```

### 12.2 Commission Processing Pipeline

```
         SubOrder.fulfillmentStatus = DELIVERED
         SubOrder.returnWindowEndsAt <= now
         SubOrder.commissionProcessed = false
         MasterOrder.paymentStatus = PAID
                       |
                       v  (Cron: every 15 seconds)
              +--------+---------+
              | For each eligible |
              | SubOrder          |
              +--------+---------+
                       |
                       v
              +--------+---------+
              | For each OrderItem|
              |   in SubOrder     |
              +--------+---------+
                       |
                       v
              +--------+------------------+
              | Lookup SellerProductMapping |
              | Get settlementPrice        |
              | (fallback: 80% of price)   |
              +--------+------------------+
                       |
                       v
              +--------+---------+
              | Create           |
              | CommissionRecord |
              | status: PENDING  |
              +--------+---------+
                       |
                       v
              +--------+---------+
              | Mark SubOrder    |
              | commissionProcessed|
              | = true           |
              +------------------+
```

### 12.3 Settlement Cycle

```
Admin creates SettlementCycle (periodStart, periodEnd)
                       |
                       v
              +--------+---------+
              | Aggregate PENDING |
              | CommissionRecords |
              | in date range     |
              +--------+---------+
                       |
                       v
              +--------+---------+
              | Group by Seller   |
              | Calculate totals: |
              | - totalOrders     |
              | - totalItems      |
              | - totalPlatform   |
              | - totalSettlement |
              | - totalMargin     |
              +--------+---------+
                       |
                       v
              +--------+---------+          +------------------+
              | SettlementCycle   |          | SellerSettlement  |
              | status: DRAFT    +--------->| (one per seller)  |
              +--------+---------+          | status: PENDING   |
                       |                    +------------------+
                       v
                  Admin reviews
                       |
              +--------v---------+
              | status: APPROVED |
              +--------+---------+
                       |
                  Admin pays
                       |
              +--------v---------+
              | Mark PAID        |
              | Record UTR ref   |
              | Update records   |
              | to SETTLED       |
              +------------------+

Reconciliation Check:
  - deliveredItems == commissionRecords?
  - platformTotal - settlementTotal == marginTotal? (tolerance: 0.01)
  - Returns: { status: 'MATCHED' | 'MISMATCHED', mismatches: [] }
```

---

## 13. Inventory Management System

### 13.1 Multi-Seller Inventory Model

Unlike traditional single-seller inventory, SPORTSMART uses a **seller-product mapping** model where multiple sellers can stock the same product.

```
Product: "Nike Air Max 90" (PRD-000042)
  |
  +-- Variant: Size 9, Black (SKU: PRD-000042-9-BLA)
  |     |
  |     +-- Seller A: 50 units, Rs 800 settlement, Pincode 400001
  |     +-- Seller B: 30 units, Rs 820 settlement, Pincode 560001
  |     +-- Seller C: 15 units, Rs 790 settlement, Pincode 110001
  |
  +-- Variant: Size 10, White (SKU: PRD-000042-10-WHI)
        |
        +-- Seller A: 20 units, Rs 850 settlement, Pincode 400001
        +-- Seller D: 40 units, Rs 830 settlement, Pincode 600001
```

**Storefront aggregation:**
```
Customer sees:
  Nike Air Max 90 - Size 9, Black
  Price: Rs 1,000
  In Stock (95 units across 3 sellers)
  Delivery to 400001: Tomorrow (Seller A, 5km away)
```

### 13.2 Stock Operations

| Operation | Trigger | Effect |
|-----------|---------|--------|
| **Reserve** | Checkout initiate | reservedQty += qty, create StockReservation |
| **Release** | Session expires / order cancelled | reservedQty -= qty, reservation EXPIRED/RELEASED |
| **Confirm** | Order placed | stockQty -= qty, reservedQty -= qty, reservation CONFIRMED |
| **Adjust** | Admin/Seller manual | stockQty += adjustment (positive or negative) |
| **Import** | Bulk CSV | Batch update stockQty by SKU |
| **Restore** | Seller rejection + reallocation | Original seller's stockQty += qty |

### 13.3 Inventory Dashboard Metrics

```
+-------------------------------------------------------+
| INVENTORY OVERVIEW                                     |
|                                                        |
| Mapped Products: 1,234    Mapped Variants: 5,678      |
| Total Stock:     45,000   Reserved:        2,300       |
| Available:       42,700   Low Stock:       156         |
| Out of Stock:    89                                    |
+-------------------------------------------------------+

Low Stock = available > 0 AND available <= lowStockThreshold
Out of Stock = available <= 0 (aggregated across all sellers)
```

---

## 14. Event-Driven Architecture

### 14.1 Event Bus Design

SPORTSMART uses an **internal event bus** (NestJS EventEmitter) for async cross-module communication.

```
+------------------+     publish      +------------------+
|  Orders Service  | --------------> |   Event Bus       |
|                  |  "orders.master |  (NestJS Events)  |
|                  |   .created"     |                   |
+------------------+                 +---+---+---+------+
                                         |   |   |
                                subscribe|   |   |subscribe
                                         v   |   v
                               +---------+ | +---------+
                               |Notif.   | | | Audit   |
                               |Handler  | | | Handler |
                               +---------+ | +---------+
                                           |
                                    subscribe
                                           v
                                    +---------+
                                    |Settle.  |
                                    |Handler  |
                                    +---------+
```

### 14.2 Event Naming Convention

Format: `<module>.<aggregate>.<action>`

Examples:
- `orders.master.created`
- `orders.sub_order.reassigned`
- `catalog.listing.approved`
- `payments.captured`
- `seller.onboarding.submitted`

### 14.3 Event Catalog (140+ Events)

| Module | Key Events | Primary Consumers |
|--------|-----------|-------------------|
| **identity** | user.registered, user.logged_in, password_reset_requested | notifications, audit |
| **seller** | onboarding.submitted/approved/rejected, status.activated/suspended | notifications, audit, admin-ctrl |
| **catalog** | product.created/updated, listing.submitted/approved/rejected | search, notifications, audit |
| **inventory** | stock.reserved/released/deducted/adjusted, stock.out_of_stock | audit, search, admin-ctrl |
| **checkout** | session.created, validation.passed/failed, submitted | audit |
| **orders** | master.created, sub_order.created/accepted/rejected/shipped/delivered, master.exception | payments, settlements, notifications, audit, shipping |
| **payments** | intent.created, captured, failed, refund.completed, mismatch.detected | orders, settlements, notifications, audit, admin-ctrl |
| **shipping** | shipment.created, awb.assigned, tracking.updated, ndr.raised, rto.initiated | orders, notifications, audit, admin-ctrl |
| **returns** | requested, approved, rejected, refund.approved, dispute.opened | payments, settlements, notifications, audit, admin-ctrl |
| **settlements** | ledger.entry_recorded, run.approved, payout.marked_paid | notifications, audit, admin-ctrl |
| **affiliate** | referral.attributed, commission.locked/reversed | settlements, notifications, audit |
| **franchise** | pincode.mapped, fee.recorded, earning.locked | settlements, notifications, audit |

### 14.4 When to Use Events vs Direct Calls

| Use Events When | Use Direct Calls When |
|-----------------|----------------------|
| Multiple consumers need to react | Caller needs immediate response |
| Reaction can happen asynchronously | Part of a transaction boundary |
| Notifications, audit, analytics | Checkout/order cannot continue without result |
| Loose coupling desired | Strong consistency required |

---

## 15. Authentication & Authorization

### 15.1 Auth Architecture

```
+------------------+
|   Client App     |
| (Browser)        |
+--------+---------+
         |
    POST /auth/login
    { email, password }
         |
+--------v---------+
| Auth Controller   |
| - Validate creds  |
| - Hash comparison  |
| - Generate JWT     |
| - Create session   |
+--------+---------+
         |
    Response:
    { accessToken, refreshToken }
         |
+--------v---------+
| Subsequent Reqs   |
| Authorization:    |
| Bearer <token>    |
+------------------+
```

### 15.2 JWT Structure

```json
{
  "sub": "user-uuid",
  "role": "CUSTOMER | SELLER | ADMIN",
  "iat": 1711500000,
  "exp": 1711586400
}
```

### 15.3 Role-Based Access Control (RBAC)

```
+-------------------+---------------------------------------------------+
| Role              | Permissions                                       |
+-------------------+---------------------------------------------------+
| CUSTOMER          | Cart, Checkout, Orders (own), Profile (own)       |
| SELLER            | Products (own), Inventory (own), Orders (assigned)|
| SELLER_STAFF      | Limited seller operations                         |
| ADMIN             | All operations (scoped by AdminRole)              |
|   SUPER_ADMIN     | Full platform access + impersonation              |
|   SELLER_ADMIN    | Seller management + impersonation                 |
|   SELLER_SUPPORT  | Seller support operations                         |
|   SELLER_OPERATIONS| Order & inventory operations                     |
| AFFILIATE         | Referral management, commission viewing           |
| FRANCHISE         | Regional operations, earnings viewing             |
+-------------------+---------------------------------------------------+
```

### 15.4 Auth Flow by Persona

| Persona | Registration | Login | Token Storage | Session |
|---------|-------------|-------|---------------|---------|
| Customer | Self-register | Email + password | sessionStorage | Session table |
| Seller | Self-register + admin approval | Email/phone + password | sessionStorage | SellerSession table |
| Admin | Seeded / Super Admin creates | Email + password | sessionStorage | AdminSession table |

---

## 16. External Integrations

### 16.1 Anti-Corruption Layer Pattern (ADR-002)

All external services are wrapped in **adapter modules** that normalize provider-specific payloads into internal domain types.

```
+---------------------+     +---------------------+     +---------------------+
| Business Module     |     | Integration Adapter |     | External Provider   |
| (e.g., Payments)    |     | (e.g., Razorpay)    |     | (e.g., Razorpay API)|
|                     |     |                     |     |                     |
| Uses internal types:| --> | Maps to/from:       | --> | Provider-specific:  |
| PaymentCaptureReq   |     | razorpay.orders     |     | POST /orders        |
| PaymentCaptureRes   |     | .create()           |     | { amount, currency }|
+---------------------+     +---------------------+     +---------------------+
```

### 16.2 Integration Map

| Integration | Module | Adapter | Internal Types |
|------------|--------|---------|----------------|
| **Razorpay** | payments | `integrations/razorpay/` | NormalizedPaymentCaptureResult, NormalizedRefundResult |
| **Shiprocket** | shipping | `integrations/shiprocket/` | NormalizedTrackingEvent, NormalizedShipmentCreateResult |
| **OpenSearch** | search | `integrations/opensearch/` | Internal search request/response contracts |
| **Cloudinary** | files | `integrations/cloudinary/` | Internal file upload/delete contracts |
| **AWS S3** | files | `integrations/s3/` | Internal file storage contracts |
| **SMTP Email** | notifications | `integrations/email/` | Normalized outbound message |
| **WhatsApp** | notifications | `integrations/whatsapp/` | Normalized outbound message |

### 16.3 Email Notification Events

The email handler subscribes to domain events and sends formatted HTML emails:

| Event | Recipients | Email Content |
|-------|-----------|---------------|
| `seller.registered` | Seller | Welcome + verify email reminder |
| `seller.email_verified` | Seller | Confirmation + next steps |
| `orders.master.created` | Customer + Admin | Order confirmation with order# and total |
| `orders.sub_order.created` | Seller | New order notification with items |
| `catalog.listing.submitted_for_qc` | Admin | Product review request |
| `catalog.listing.approved` | Seller | Product now active notification |
| `catalog.listing.rejected` | Seller | Rejection with reason |
| `seller.account_locked` | Seller | Temporary lock notification |

---

## 17. Frontend Architecture

### 17.1 Multi-App Strategy

Each persona has a dedicated Next.js application, sharing packages but independently deployable.

```
+-------------------------------------------------------------------+
|                        Shared Packages                             |
|  @sportsmart/ui    @sportsmart/shared-types   @sportsmart/config  |
|  @sportsmart/shared-utils   @sportsmart/tsconfig                  |
+-------------------------------------------------------------------+
       |              |              |              |              |
+------+---+ +-------+---+ +-------+---+ +-------+---+ +-------+---+
|Storefront| |  Seller   | |  Admin    | |Admin Store| | Affiliate |
| :3001    | |  :3002    | |  :3003    | |  :3006    | |  :3004    |
|          | |           | |           | |           | |           |
| Browse   | | Products  | | Dashboard | | Storefront| | (Future)  |
| Cart     | | Orders    | | Sellers   | | Products  | |           |
| Checkout | | Profile   | | Orders    | | Inventory | |           |
| Orders   | | Earnings  | | Commis.   | | Discounts | |           |
+----------+ +-----------+ +-----------+ +-----------+ +-----------+
```

### 17.2 Frontend Patterns

| Pattern | Implementation |
|---------|---------------|
| **Routing** | Next.js App Router (file-based) |
| **Auth** | JWT in sessionStorage, Bearer header injection |
| **API Client** | Centralized `apiClient()` with error normalization |
| **State** | Local component state (useState), no global store |
| **Data Fetching** | useEffect + useCallback, manual pagination |
| **Forms** | Manual validation with validators.ts utilities |
| **Search** | 400ms debounced input with API calls |
| **Styling** | CSS variables design system + per-page CSS files |
| **Rich Text** | react-quill-new for product descriptions/policies |

### 17.3 Design System (CSS Variables)

```css
--color-primary:        #2563eb   (Blue)
--color-error:          #dc2626   (Red)
--color-success:        #16a34a   (Green)
--color-warning:        #d97706   (Amber)
--color-text:           #111827   (Dark)
--color-text-secondary: #6b7280   (Gray)
--color-border:         #d1d5db   (Light gray)
--color-bg:             #ffffff   (White)
--color-bg-page:        #f9fafb   (Off-white)
--radius:               8px
```

### 17.4 Customer Storefront Features

| Feature | Implementation |
|---------|---------------|
| Product browsing | Grid with filters (category, brand, sort, search) |
| Product detail | Multi-image gallery, variant selector, serviceability check |
| Variant selection | Color swatches + size buttons, dynamic pricing |
| Serviceability | Pincode input -> delivery estimate per seller |
| Cart | Quantity controls, stock validation, order summary |
| Checkout | Address management, seller allocation, stock reservation |
| Order tracking | 5-step progress bar, sub-order grouping, status timeline |
| Search | Navbar with autocomplete suggestions (products, categories, brands) |

---

## 18. Infrastructure & Deployment

### 18.1 Local Development

```yaml
# docker-compose.yml
services:
  postgres:
    image: postgres:16-alpine
    ports: ["5432:5432"]
    environment:
      POSTGRES_DB: sportsmart_dev
    volumes: [postgres_data:/var/lib/postgresql/data]

  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
    volumes: [redis_data:/data]
```

### 18.2 Development Workflow

```bash
# Start infrastructure
docker compose -f infra/docker/docker-compose.yml up -d

# Install dependencies
pnpm install

# Run database migrations
cd apps/api && npx prisma migrate deploy

# Seed data (admin, catalog, pincodes)
npx prisma db seed

# Start all apps
pnpm dev  # Turbo runs all apps concurrently
```

### 18.3 Production Architecture (Target)

```
                        +------------------+
                        |   CloudFront     |
                        |   (CDN)          |
                        +--------+---------+
                                 |
                        +--------v---------+
                        |   ALB / Nginx    |
                        |  (Load Balancer) |
                        +--+----+----+--+--+
                           |    |    |  |
              +------------+    |    |  +------------+
              |                 |    |               |
     +--------v--+  +---------v-+  +v---------+  +-v---------+
     | Storefront|  |  Seller   |  |  Admin   |  |   API     |
     | (Vercel)  |  | (Vercel)  |  | (Vercel) |  | (ECS/EC2) |
     +-----------+  +-----------+  +----------+  +-----+-----+
                                                        |
                                              +---------+---------+
                                              |                   |
                                     +--------v------+  +--------v------+
                                     | PostgreSQL RDS |  |  ElastiCache  |
                                     | (Multi-AZ)    |  |  (Redis)      |
                                     +---------------+  +---------------+
```

### 18.4 Environment Configuration

| Variable | Purpose | Example |
|----------|---------|---------|
| `DATABASE_URL` | PostgreSQL connection | `postgresql://user:pass@host:5432/db` |
| `REDIS_HOST` | Redis host | `redis.internal` |
| `JWT_SECRET` | Token signing key | `<256-bit random>` |
| `RAZORPAY_KEY_ID` | Payment gateway | `rzp_live_xxx` |
| `SHIPROCKET_EMAIL` | Shipping provider | `api@company.com` |
| `OPENSEARCH_NODE` | Search engine | `https://search.internal` |
| `CLOUDINARY_*` | Image CDN | Cloud name, key, secret |
| `MAIL_HOST/USER/PASS` | SMTP | Gmail app password |
| `CORS_ORIGINS` | Allowed origins | `https://sportsmart.com` |

---

## 19. Scalability Strategy

### 19.1 Current Bottlenecks & Solutions

| Bottleneck | Current State | Scale Solution |
|------------|--------------|----------------|
| **Checkout sessions** | In-memory Map | Migrate to Redis (distributed, persistent) |
| **Commission processor** | Single-instance cron (race condition) | Distributed lock (Redis SETNX) or DB advisory lock |
| **Stock reservations** | No distributed lock | Optimistic locking with version column |
| **Allocation queries** | Full table scan on PostOffice | Pre-computed distance caches, spatial indexes |
| **Seller search** | N+1 queries on mappings | Materialized views or denormalized read models |

### 19.2 Horizontal Scaling Path

```
Phase 1 (Current): Single instance
  - 1 API server, 1 PostgreSQL, 1 Redis

Phase 2 (Growth): Stateless scale-out
  - N API servers behind load balancer
  - PostgreSQL read replicas
  - Redis for sessions + checkout state
  - Distributed locks for cron jobs

Phase 3 (Scale): Module extraction
  - Extract high-traffic modules to independent services:
    1. Catalog + Search (read-heavy)
    2. Orders + Checkout (write-heavy, transaction-critical)
    3. Inventory (real-time stock management)
  - Message queue (SQS/RabbitMQ) replacing in-process event bus
  - Independent databases per extracted service

Phase 4 (Platform): Full microservices
  - All 23 modules as independent services
  - Event-driven architecture with Kafka/EventBridge
  - CQRS for high-read surfaces
  - API Gateway with rate limiting per tenant
```

### 19.3 Database Scaling

```
Read Scaling:
  Primary (writes) ──> Read Replica 1 (storefront reads)
                   ──> Read Replica 2 (admin reads)
                   ──> Read Replica 3 (reporting)

Write Scaling (Future):
  Partition by module ownership:
  - DB1: identity, seller, admin (user data)
  - DB2: catalog, inventory (product data)
  - DB3: orders, checkout, payments (transaction data)
  - DB4: settlements, commission (financial data)
```

---

## 20. Security Design

### 20.1 Authentication Security

| Measure | Implementation |
|---------|---------------|
| Password hashing | bcryptjs (salt rounds: 10) |
| JWT signing | HS256 with configurable secret |
| Session management | Per-user session table with revocation |
| Brute force protection | Failed attempt counter + account lock |
| OTP security | Hashed OTPs, max attempts (5), expiry (10 min) |
| Rate limiting | NestJS Throttler (configurable per endpoint) |

### 20.2 API Security

| Measure | Implementation |
|---------|---------------|
| CORS | Configurable allowed origins |
| Helmet | HTTP security headers (CSP, HSTS, X-Frame, etc.) |
| Input validation | class-validator with whitelist + forbidNonWhitelisted |
| XSS prevention | sanitize-html for rich text fields |
| SQL injection | Prisma parameterized queries (no raw SQL) |
| File upload | Cloudinary with size/type validation |
| Admin audit | AdminActionAuditLog for all admin operations |
| Impersonation | Logged with AdminImpersonationLog, time-boxed |

### 20.3 Data Security

| Measure | Implementation |
|---------|---------------|
| Passwords | Never stored in plaintext; bcrypt hashed |
| OTPs | Stored as hashes, not plaintext |
| Addresses | Snapshot in order (not live reference) |
| Seller bank details | Stored in seller table (should be encrypted at rest) |
| File access | Classification-based access policies |

### 20.4 Security Improvements Needed

| Priority | Issue | Recommendation |
|----------|-------|----------------|
| CRITICAL | Secrets in .env committed to git | Use AWS Secrets Manager / Vault |
| HIGH | JWT in sessionStorage (XSS vulnerable) | Migrate to httpOnly cookies |
| HIGH | No token refresh implementation | Implement refresh token rotation |
| MEDIUM | No request signing for webhooks | Add HMAC verification |
| MEDIUM | No encryption at rest for PII | Enable PostgreSQL TDE |

---

## 21. Observability & Monitoring

### 21.1 Current State

| Capability | Implementation |
|-----------|---------------|
| Structured logging | NestJS Logger (console) |
| Audit trail | AuditLog + EventLog tables |
| Admin actions | AdminActionAuditLog |
| Allocation tracing | AllocationLog table |
| Order reassignment | OrderReassignmentLog |
| Product moderation | ProductStatusHistory |

### 21.2 Recommended Monitoring Stack

```
+-------------------+     +-------------------+     +-------------------+
| Application Logs  |     | Metrics           |     | Traces            |
| (CloudWatch/ELK)  |     | (Prometheus/CW)   |     | (Jaeger/X-Ray)    |
+--------+----------+     +--------+----------+     +--------+----------+
         |                          |                          |
         +----------+---------------+--------------------------+
                    |
           +--------v---------+
           |   Grafana        |
           |   Dashboards     |
           +------------------+
```

### 21.3 Key Metrics to Monitor

| Category | Metric | Alert Threshold |
|----------|--------|-----------------|
| **Orders** | Orders placed/hour | < 50% of baseline |
| **Orders** | Exception queue depth | > 20 orders |
| **Orders** | Seller acceptance rate | < 80% |
| **Inventory** | Out-of-stock products | > 10% of catalog |
| **Inventory** | Reservation expiry rate | > 30% |
| **Allocation** | Unserviceable rate | > 15% |
| **Allocation** | Avg allocation distance | > 500km |
| **Commission** | Unprocessed sub-orders | > 100 |
| **Settlement** | Pending settlements age | > 7 days |
| **API** | p95 response time | > 1s |
| **API** | Error rate (5xx) | > 1% |
| **Auth** | Failed login rate | > 100/hour |

---

## 22. Failure Modes & Resilience

### 22.1 Failure Scenarios & Handling

| Scenario | Impact | Current Handling | Recommended |
|----------|--------|-----------------|-------------|
| **DB connection loss** | All operations fail | Prisma connection pooling with retry | Add circuit breaker, health check endpoint |
| **Redis down** | Cache miss, rate limiting fails | Graceful degradation (no cache) | Redis Sentinel/Cluster for HA |
| **Checkout session lost** | Customer loses cart state | In-memory Map (lost on restart) | **Migrate to Redis/DB** |
| **Email service down** | Notifications not sent | Silent failure (logged only) | Dead letter queue + retry |
| **Seller rejects order** | Order needs reallocation | Automatic reallocation to next seller | Already handled with EXCEPTION_QUEUE fallback |
| **Stock oversell** | More orders than stock | Reservation-based holds | Add optimistic locking on stock updates |
| **Commission double-process** | Duplicate records | No protection | **Add distributed lock or atomic flag** |
| **Payment webhook miss** | Order stuck in PENDING | No retry mechanism | Implement idempotent webhook processing + polling |
| **PostOffice data missing** | All allocations fail | Silent "not serviceable" | Add health check for critical seed data |

### 22.2 Data Consistency Guarantees

| Flow | Consistency Level | Mechanism |
|------|------------------|-----------|
| Stock reservation | Strong | Prisma transaction (atomic increment + create) |
| Order creation | Strong | Prisma transaction (order + sub-orders + confirmations) |
| Commission processing | Eventual | Cron job (needs distributed lock) |
| Settlement creation | Strong | Prisma transaction (cycle + settlements + record links) |
| Event publishing | Best-effort | In-process event bus (no persistence) |

---

## 23. Future Roadmap

### 23.1 Immediate Priorities (P0)

| Item | Description | Effort |
|------|-------------|--------|
| Fix return window | Change from 60s test value to configurable (default 14 days) | 1 hour |
| Move checkout to Redis | Replace in-memory Map with Redis-backed sessions | 2-3 days |
| Commission locking | Add distributed lock to prevent duplicate processing | 1 day |
| Discount integration | Wire discount engine into checkout price calculation | 3-5 days |
| Secret management | Remove secrets from .env, use Vault/Secrets Manager | 2 days |

### 23.2 Short-Term (1-3 Months)

| Item | Description |
|------|-------------|
| Payment integration | Complete Razorpay webhook processing and order state transitions |
| Shipping integration | Wire Shiprocket for label generation, tracking, NDR/RTO |
| Returns module | Implement return request flow, QC, refund orchestration |
| Search module | OpenSearch indexing, full-text product search |
| Token refresh | Implement JWT refresh rotation across all frontends |
| Error boundaries | Add React error boundaries to all frontend apps |

### 23.3 Medium-Term (3-6 Months)

| Item | Description |
|------|-------------|
| Affiliate program | Referral links, attribution tracking, commission model |
| Franchise system | Regional fulfillment, pincode mapping, service fees |
| Real-time updates | WebSocket for order status, inventory changes |
| CI/CD pipeline | GitHub Actions for test, build, deploy |
| Monitoring stack | Prometheus + Grafana dashboards |
| Performance optimization | Read replicas, caching strategy, query optimization |

### 23.4 Long-Term (6-12 Months)

| Item | Description |
|------|-------------|
| Mobile apps | React Native customer + seller apps |
| Multi-commission models | Per-category, per-seller, tiered commission rules |
| AI-powered search | Semantic search, personalized recommendations |
| Microservice extraction | Split catalog/search and orders as first candidates |
| Multi-currency | Support for international sellers |
| Analytics platform | BI dashboards, seller analytics, customer insights |

---

## Appendix A: Key File Locations

| File | Purpose |
|------|---------|
| `apps/api/src/app.module.ts` | Root module composition |
| `apps/api/src/main.ts` | Application bootstrap |
| `apps/api/prisma/schema/` | 19 modular schema files |
| `apps/api/src/modules/` | 23 business modules |
| `apps/api/src/integrations/` | Anti-corruption adapters |
| `docs/decisions/001-strict-modular-monolith.md` | Architecture decision |
| `docs/decisions/002-anti-corruption-integrations.md` | Integration pattern |
| `docs/architecture/module-boundaries.md` | Module ownership |
| `docs/architecture/dependency-matrix.md` | Allowed dependencies |
| `docs/architecture/event-catalog.md` | 140+ event definitions |
| `docs/flows/commerce-lifecycle.md` | 8 core business flows |

## Appendix B: Port Allocation

| Port | Application |
|------|------------|
| 3001 | web-storefront (Customer) |
| 3002 | web-seller (Seller portal) |
| 3003 | web-admin (Admin dashboard) |
| 3004 | web-affiliate (Future) |
| 3005 | web-franchise (Future) |
| 3006 | web-admin-storefront |
| 4000 | API backend (NestJS) |
| 5432 | PostgreSQL |
| 6379 | Redis |

## Appendix C: Seed Data

| Seed | Records | Purpose |
|------|---------|---------|
| seed-admin | 1 | Super admin account |
| seed-catalog (Part 1-4) | ~500+ | Categories (L0/L1/L2), Brands, Option Definitions, Option Values, Category Templates |
| seed-pincodes | 165,000+ | India Post Office directory with coordinates |

---

*This document is a living artifact. Update it as the system evolves.*
