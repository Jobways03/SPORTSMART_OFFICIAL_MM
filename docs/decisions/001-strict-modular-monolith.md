# ADR-001: Strict Modular Monolith Architecture

## Status
Accepted

## Context
SPORTSMART is a multi-seller sports marketplace with complex commerce flows
spanning checkout, orders, payments, shipping, returns, and settlements.
Multiple stakeholders (sellers, affiliates, franchises, admin) need separate
portals but share core business logic.

## Decision
Use a strict modular monolith with:
- One NestJS backend deployable (apps/api)
- Multiple Next.js frontend apps
- One PostgreSQL database (logically owned per module)
- Clear bounded modules with public facade interfaces
- Internal events for async cross-module reactions
- Anti-corruption adapters for external integrations

## Rules
1. Each module owns its business logic and data tables
2. No direct cross-module repository access
3. Cross-module communication via public facades or events only
4. External integrations wrapped in anti-corruption adapters
5. Dependency direction: presentation -> application -> domain
6. Shared code limited to framework primitives only

## Consequences
- Clear ownership prevents architecture drift
- Modules can be extracted to microservices later if needed
- Slightly more boilerplate for cross-module calls
- Event catalog must be maintained as system grows
