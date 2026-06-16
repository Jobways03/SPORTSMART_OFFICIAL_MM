# Parked Nova admin pages

These pages (`flash-sales`, `blog-posts`, `events`, `product-reviews`,
`storefront-content`, `storefront-slots`) were the only source in `web-admin`
before it was given a proper Next scaffold. They import service modules that
were never committed to this app:

- `@/lib/api-client`
- `@/services/admin-flash-sales.service`
- `@/services/admin-blog-posts.service`
- `@/services/admin-events.service`
- `@/services/admin-product-reviews.service`
- `@/services/admin-storefront-content.service`
- `@/services/admin-storefront-slots.service`

The `_parked/` prefix makes Next treat this as a private folder, so the files
are **kept** (not deleted) but excluded from routing and `next build`. The
working implementation of most of this functionality lives in
`apps/web-admin-storefront`. To revive a page here, port over the matching
service from `web-admin-storefront/src/services` (or write the two that have no
counterpart there: `admin-events` and `admin-product-reviews`) and move the
route back under `src/app/`.
