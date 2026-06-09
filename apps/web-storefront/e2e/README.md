# Storefront UI E2E (Playwright)

Browser-driven end-to-end tests for the customer storefront. `order.spec.ts`
drives the full purchase flow in a real browser: **login → product → add to
cart → checkout → place a COD order → land on the confirmation page.**

## One-time setup

```bash
# from the repo root
pnpm install                                   # pulls in @playwright/test
pnpm --filter @sportsmart/web-storefront exec playwright install chromium
```

## Preconditions for a run

1. **Dev stack up** — API on `:8000` and storefront on `:4005`:
   ```bash
   pnpm exec turbo run dev --concurrency=16
   ```
2. **Seed a purchasable product** (the demo catalog ships with DRAFT variants
   and no serviceability, so nothing is buyable out of the box):
   ```bash
   pnpm --filter @sportsmart/api exec ts-node \
     prisma/seed/seed-purchasable-product.ts
   ```
   This activates a variant + provisions the seller mapping and a COD-eligible
   service area for the test pincode (default `560001`).

The **smoke customer** (`smoke-customer@sportsmart.test`) and a serviceable
address are ensured automatically by the spec's `beforeAll` over the API, so you
don't need to create them by hand. (Seed the customer once with
`seed-smoke-actors` if it's a fresh DB.)

## Run

```bash
pnpm --filter @sportsmart/web-storefront e2e          # headless
pnpm --filter @sportsmart/web-storefront e2e:ui       # Playwright UI mode
pnpm --filter @sportsmart/web-storefront e2e:headed   # watch the browser
```

## Configuration (env overrides)

| Var | Default | Purpose |
|-----|---------|---------|
| `E2E_BASE_URL` | `http://localhost:4005` | storefront origin |
| `E2E_API_URL` | `http://localhost:8000` | API origin (precondition setup) |
| `E2E_EMAIL` / `E2E_PASSWORD` | smoke customer | login |
| `E2E_PRODUCT_SLUG` | `nova-sm-elite-cricket-batting-gloves` | product to buy |
| `E2E_PINCODE` | `560001` | delivery pincode (must match the seed) |

## Notes

- Selectors use accessible roles/text (`Sign in`, `Add to cart`, `Checkout`,
  `Cash on Delivery`, `Pay when you receive`) because the storefront has no
  `data-testid`s yet. If a button label changes, update the matching selector.
- Each run creates a real order (`SM…`) in the dev DB — expected for an E2E.
- Failures retain a trace + screenshot + video under `test-results/`
  (`pnpm exec playwright show-trace <trace.zip>`).
