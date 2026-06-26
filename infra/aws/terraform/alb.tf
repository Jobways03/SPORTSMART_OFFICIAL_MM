# Public ALB terminating TLS for every service. A single ACM wildcard cert
# *.<env_domain> covers all service hostnames (each is one label under
# env_domain). Per-service routing (host-header listener rules), target
# groups and DNS records live in ecs.tf next to the services.

resource "aws_lb" "main" {
  name               = local.name
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = [for s in aws_subnet.public : s.id]

  drop_invalid_header_fields = true
  tags                       = { Name = local.name }
}

# ── ACM wildcard certificate (DNS-validated in the hosted zone) ─────────
resource "aws_acm_certificate" "wildcard" {
  domain_name = "*.${var.env_domain}"
  # When serving the bare apex (production, var.serve_apex), add it as a SAN — a
  # wildcard *.<domain> does NOT cover the apex <domain> itself. www IS covered
  # by the wildcard, so it is intentionally NOT added here. Using null (not [])
  # for the disabled case leaves staging's existing cert untouched (no SAN ⇒ no
  # diff / no replacement).
  subject_alternative_names = var.serve_apex ? [var.env_domain] : null
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = { Name = "${local.name}-wildcard" }
}

resource "aws_route53_record" "cert_validation" {
  # Keyed by the validation RECORD NAME (not domain_name): ACM returns the SAME
  # validation CNAME for *.<domain> and the apex <domain>, so keying by domain
  # would create two record resources contending for one name. The trailing `...`
  # groups duplicates into a single record per unique validation name; the grouped
  # entries are identical, so indexing [0] is correct.
  for_each = {
    for dvo in aws_acm_certificate.wildcard.domain_validation_options :
    dvo.resource_record_name => {
      name   = dvo.resource_record_name
      type   = dvo.resource_record_type
      record = dvo.resource_record_value
    }...
  }

  zone_id         = local.hosted_zone_id
  name            = each.value[0].name
  type            = each.value[0].type
  records         = [each.value[0].record]
  ttl             = 60
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "wildcard" {
  certificate_arn         = aws_acm_certificate.wildcard.arn
  validation_record_fqdns = [for r in aws_route53_record.cert_validation : r.fqdn]
}

# ── Listeners ───────────────────────────────────────────────────────────
# HTTPS: default action is a 404 (no host matched a service rule).
resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.main.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = aws_acm_certificate_validation.wildcard.certificate_arn

  default_action {
    type = "fixed-response"
    fixed_response {
      content_type = "text/plain"
      message_body = "No service for this host."
      status_code  = "404"
    }
  }
}

# HTTP: permanent redirect to HTTPS.
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"
    redirect {
      protocol    = "HTTPS"
      port        = "443"
      status_code = "HTTP_301"
    }
  }
}
