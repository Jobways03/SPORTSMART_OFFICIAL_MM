# ─────────────────────────────────────────────────────────────────────────
# Low-cost NAT instance — alternative to the managed NAT gateway for NON-PROD.
#
# Gated on var.use_nat_instance:
#   true  → a single fck-nat instance (default t4g.nano, ~$3-4/mo) provides
#           private-subnet egress; the NAT gateway + its EIP in network.tf are
#           count-gated to zero, and the private route points at this instance.
#   false → not created; the managed NAT gateway is used (production default).
#
# A managed NAT gateway costs ~$0.056/hr (~$40/mo) just to exist. This instance
# is ~10x cheaper but is a single point of failure with NO managed failover —
# acceptable for a staging env that's parked when idle, NOT for production
# (keep use_nat_instance=false there). Rollback is one flag: set it false and
# `terraform apply` — the managed gateway returns.
#
# Image: fck-nat (https://github.com/AndrewGuenther/fck-nat) — a small, widely
# used OSS AMI that enables IP-forwarding + masquerade automatically, so there
# is no hand-written NAT bootstrap to get wrong. To avoid a third-party AMI,
# replace data.aws_ami.fck_nat with an Amazon Linux 2023 image + a user_data
# NAT bootstrap (the route/SG/EIP wiring below is unchanged).
# ─────────────────────────────────────────────────────────────────────────

data "aws_ami" "fck_nat" {
  count       = var.use_nat_instance ? 1 : 0
  most_recent = true
  owners      = ["568608671756"] # fck-nat publisher

  filter {
    name   = "name"
    values = ["fck-nat-al2023-hvm-*-arm64-ebs"]
  }
  filter {
    name   = "state"
    values = ["available"]
  }
}

resource "aws_security_group" "nat_instance" {
  count       = var.use_nat_instance ? 1 : 0
  name        = "${local.name}-nat-instance"
  description = "NAT instance: masquerade egress for private subnets"
  vpc_id      = aws_vpc.main.id

  ingress {
    description = "All traffic from inside the VPC (NATed out to the internet)"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = [var.vpc_cidr]
  }
  egress {
    description = "All egress to the internet"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${local.name}-nat-instance" }
}

# Stable egress IP (kept across instance replacement; external partners can
# allowlist it).
resource "aws_eip" "nat_instance" {
  count  = var.use_nat_instance ? 1 : 0
  domain = "vpc"
  tags   = { Name = "${local.name}-nat-instance" }
}

resource "aws_instance" "nat" {
  count                       = var.use_nat_instance ? 1 : 0
  ami                         = data.aws_ami.fck_nat[0].id
  instance_type               = var.nat_instance_type
  subnet_id                   = aws_subnet.public[local.azs[0]].id
  vpc_security_group_ids      = [aws_security_group.nat_instance[0].id]
  associate_public_ip_address = true
  # Required: this instance forwards packets it is neither source nor dest of.
  source_dest_check = false

  tags = { Name = "${local.name}-nat-instance" }

  depends_on = [aws_internet_gateway.main]
}

resource "aws_eip_association" "nat_instance" {
  count         = var.use_nat_instance ? 1 : 0
  instance_id   = aws_instance.nat[0].id
  allocation_id = aws_eip.nat_instance[0].id
}

output "nat_instance_public_ip" {
  description = "Egress IP of the NAT instance (null unless use_nat_instance=true)."
  value       = var.use_nat_instance ? aws_eip.nat_instance[0].public_ip : null
}
