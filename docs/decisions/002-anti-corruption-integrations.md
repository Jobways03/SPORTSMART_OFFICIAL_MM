# ADR-002: Anti-Corruption Layer for External Integrations

## Status
Accepted

## Context
SPORTSMART integrates with Razorpay (payments), Shiprocket (shipping),
OpenSearch (search), S3 (storage), WhatsApp/Email (notifications).
Raw provider payloads must not leak into business domain logic.

## Decision
All external integrations live in `integrations/` as anti-corruption adapters.
Each adapter:
- Accepts internal normalized request types
- Returns internal normalized response types
- Maps provider-specific payloads internally
- Is only consumed by its designated business module

## Mapping
| Integration | Consumed By | Normalized Output |
|------------|-------------|-------------------|
| razorpay | payments | NormalizedPaymentCaptureResult, NormalizedRefundResult |
| shiprocket | shipping | NormalizedTrackingEvent, NormalizedShipmentCreateResult |
| opensearch | search | Internal search request/response contracts |
| s3 | files | Internal file storage contracts |
| whatsapp | notifications | Normalized outbound message |
| email | notifications | Normalized outbound message |

## Consequences
- Business modules never depend on provider-specific types
- Provider can be swapped with minimal impact
- Clear testing boundaries
