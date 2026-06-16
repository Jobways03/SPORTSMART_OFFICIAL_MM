# VPC with 2 public + 2 private subnets across 2 AZs.
#   - Public subnets host the ALB (and the NAT gateway).
#   - Private subnets host the Fargate tasks, RDS and Redis (no public IPs).
# A single NAT gateway keeps staging cost down; production can move to one
# NAT per AZ for HA (see README).

resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = { Name = local.name }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = local.name }
}

resource "aws_subnet" "public" {
  for_each = { for idx, az in local.azs : az => idx }

  vpc_id                  = aws_vpc.main.id
  availability_zone       = each.key
  cidr_block              = cidrsubnet(var.vpc_cidr, 4, each.value)
  map_public_ip_on_launch = true

  tags = { Name = "${local.name}-public-${each.key}", Tier = "public" }
}

resource "aws_subnet" "private" {
  for_each = { for idx, az in local.azs : az => idx }

  vpc_id            = aws_vpc.main.id
  availability_zone = each.key
  # Offset by 8 so private blocks never collide with the public ones above.
  cidr_block = cidrsubnet(var.vpc_cidr, 4, each.value + 8)

  tags = { Name = "${local.name}-private-${each.key}", Tier = "private" }
}

# ── Public routing ──────────────────────────────────────────────────────
resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "${local.name}-public" }
}

resource "aws_route" "public_internet" {
  route_table_id         = aws_route_table.public.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.main.id
}

resource "aws_route_table_association" "public" {
  for_each       = aws_subnet.public
  subnet_id      = each.value.id
  route_table_id = aws_route_table.public.id
}

# ── NAT ─────────────────────────────────────────────────────────────────
# nat_per_az=false → one shared NAT (cheap staging; egress SPOF).
# nat_per_az=true  → one NAT per AZ (prod HA; each private subnet egresses
#                    via its same-AZ NAT).
locals {
  nat_azs = var.nat_per_az ? local.azs : [local.azs[0]]
}

resource "aws_eip" "nat" {
  for_each = toset(local.nat_azs)
  domain   = "vpc"
  tags     = { Name = "${local.name}-nat-${each.key}" }
}

resource "aws_nat_gateway" "main" {
  for_each      = toset(local.nat_azs)
  allocation_id = aws_eip.nat[each.key].id
  subnet_id     = aws_subnet.public[each.key].id
  tags          = { Name = "${local.name}-nat-${each.key}" }

  depends_on = [aws_internet_gateway.main]
}

# ── Private routing (egress via NAT) ────────────────────────────────────
# One route table per private subnet/AZ, each routing to its same-AZ NAT
# (or the single shared NAT when nat_per_az=false).
resource "aws_route_table" "private" {
  for_each = aws_subnet.private
  vpc_id   = aws_vpc.main.id
  tags     = { Name = "${local.name}-private-${each.key}" }
}

resource "aws_route" "private_nat" {
  for_each               = aws_subnet.private
  route_table_id         = aws_route_table.private[each.key].id
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = var.nat_per_az ? aws_nat_gateway.main[each.key].id : aws_nat_gateway.main[local.azs[0]].id
}

resource "aws_route_table_association" "private" {
  for_each       = aws_subnet.private
  subnet_id      = each.value.id
  route_table_id = aws_route_table.private[each.key].id
}
