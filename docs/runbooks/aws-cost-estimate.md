# AWS Monthly Cost — Estimate & Cost-Lean Tier

ap-south-1 (Mumbai), ECS Fargate. All figures are **on-demand list prices, 730-hr
month, USD**, derived from the as-built Terraform (`infra/aws/terraform/`). They are
a planning estimate, not a quote — verify against the AWS Pricing Calculator before
committing a budget. Traffic-driven lines (NAT egress, ALB LCU, log ingest) are
modest explicit assumptions; real bills scale with load.

See also: `infra/aws/terraform/README.md`, `docs/runbooks/release-checklist.md`.

---

## TL;DR

| Tier | Staging | Production | Combined |
|---|--:|--:|--:|
| As-originally-designed (HA everywhere) | ~$340 | ~$1,190 | **~$1,525** |
| **Cost-lean (current tfvars)** | **~$150** | **~$210** | **~$360** |

The lean tier is what `staging.tfvars` / `production.tfvars` are set to today. It is
provisioned for a **low-traffic MVP, not an uptime SLA** — see the tradeoffs below.

INR (≈₹83/USD, **+18% GST** on the AWS India invoice): lean combined ≈ ₹30,000 →
**~₹35,000/mo** with GST.

---

## What the lean tier sets (and what each costs)

| Line | Production setting | Staging setting | Prod $ | Stg $ |
|---|---|---|--:|--:|
| RDS Postgres | `db.t4g.small` Single-AZ, 20 GB gp3, 14-day PITR | `db.t4g.micro`, 7-day PITR | ~$29 | ~$13 |
| ElastiCache Redis | `cache.t4g.small` ×1 (`redis_ha=false`) | `cache.t4g.micro` ×1 | ~$32 | ~$16 |
| Fargate | 5 tasks (api 2 + storefront 2 + admin 1; 8 portals→0), max 3 | 3 tasks (api/storefront/admin ×1) | ~$79 | ~$45 |
| NAT Gateway | 1 shared (`nat_per_az=false`) | 1 shared | ~$41 | ~$41 |
| VPC endpoints | **off** (`enable_vpc_endpoints=false`) | **off** | $0 | $0 |
| ALB | 1 (host-header routed) | 1 | ~$22 | ~$20 |
| CloudWatch logs + alarms | 14-day retention + 15 alarms | 3-day retention | ~$5 | ~$4 |
| Secrets / KMS / misc | 2 secrets + 1 CMK | same | ~$5 | ~$3 |
| ECR + TF state (shared) | counted once | — | — | ~$11 |
| **Total** | | | **~$210** | **~$150** |

Every one of those settings except log retention is a **Terraform variable** — a
`tfvars` edit, no code change. Log retention was hardcoded `30` in `logs.tf`; it is
now the `log_retention_days` variable (default 30).

---

## Tradeoffs accepted (read before treating prod as authoritative)

- **No automatic failover** — RDS is Single-AZ and Redis is a single node. An
  AZ/instance failure (or routine RDS maintenance) is a **downtime window** until AWS
  replaces the node. PITR backups stay on (14-day prod), so **data durability is
  unaffected — only availability drops.**
- **`redis_ha=false` turns off in-transit TLS** (`REDIS_URL` becomes `redis://`).
  Safe: Redis is reachable only from Fargate inside the private subnets. `/ready`
  folds Redis in, so a Redis-node loss is an API-unavailability window.
- **`db.t4g.small` is burstable (2 vCPU / 2 GB)** — under sustained load it can
  exhaust CPU credits and stall the connection pool. Watch `CPUCreditBalance`.
- **8 seller/franchise/affiliate portals run at 0** — first hit cold-starts (~1 min);
  scale on demand: `aws ecs update-service --cluster sportsmart-production --service <svc> --desired-count 1`.
- **Single NAT + VPC endpoints off** — ECR pulls / Secrets / KMS / Logs egress over
  the one NAT, putting it on the task-launch critical path. (Endpoints cost ~$95/mo,
  far more than the NAT data they'd save at MVP traffic — so off is cheaper here.)

---

## Buy-back ladder (re-add resilience as traffic/revenue grow)

Each is a one-line `tfvars` flip; all stay well under $500 combined even stacked.

1. `redis_ha = true` — **+~$32** (2nd node) restores Redis failover + TLS. *Highest-value first buy.*
2. `rds_multi_az = true` — **roughly doubles the RDS line** — buys DB failover; do this when an uptime SLA is committed.
3. Portal `service_desired_count` 0→1 — **+~$11 each** as those user bases come online.
4. `rds_instance_class` → `db.t4g.medium` — **+~$40** if CPU credits deplete.
5. `nat_per_az = true` (+~$41) and `enable_vpc_endpoints = true` (+~$95/env) — last, when egress/deploy volume makes the single NAT a real risk.

## Deeper cuts (not applied — need code edits)

- **Fargate Spot** for stateless web tasks (~70% off those) — needs an
  `aws_ecs_cluster_capacity_providers` resource + `capacity_provider_strategy`.
- **Public-IP tasks, NAT eliminated** — move tasks to public subnets
  (`assign_public_ip=true`) and drop the NAT; saves the NAT line but exposes task
  ENIs (lock the SG to ALB-only). Together these reach ~$128/mo combined.

---

## Caveats

- List prices as of early-2026 knowledge; `db.t4g.small` RDS in particular ranges
  ~$26–50/mo by exact rate — the budget holds either way.
- Free tier, Savings Plans, and Reserved Instances are **not** applied. A 1-yr
  Compute Savings Plan + RDS/ElastiCache RIs would cut the steady-state further.
- Storage modeled at the 20 GB floor (not the autoscale ceiling).
