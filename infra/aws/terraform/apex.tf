# Apex serving — gated on var.serve_apex (production only; staging keeps the
# wildcard cert + per-subdomain records and these resources are absent).
#
# Serves the customer storefront (web-storefront) at the BARE APEX env_domain
# (e.g. https://sportsmart.com) and 301-redirects www → apex. The bare-apex ACM
# SAN is added in alb.tf (a wildcard *.<domain> does not cover the apex); www is
# already covered by the wildcard cert. See docs/runbooks/PRODUCTION_APEX_CUTOVER.md.

locals {
  apex_host = var.env_domain
  www_host  = "www.${var.env_domain}"
}

# Apex host-header → the web-storefront target group. Priority 100 sits well
# clear of the per-service rules (local.service_priority = 1..11 in ecs.tf).
resource "aws_lb_listener_rule" "apex_storefront" {
  count        = var.serve_apex ? 1 : 0
  listener_arn = aws_lb_listener.https.arn
  priority     = 100

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.this["web-storefront"].arn
  }

  condition {
    host_header {
      values = [local.apex_host]
    }
  }
}

# www → 301 redirect to the apex (single canonical host), preserving path+query.
resource "aws_lb_listener_rule" "www_redirect" {
  count        = var.serve_apex ? 1 : 0
  listener_arn = aws_lb_listener.https.arn
  priority     = 101

  action {
    type = "redirect"
    redirect {
      protocol    = "HTTPS"
      port        = "443"
      host        = local.apex_host
      path        = "/#{path}"
      query       = "#{query}"
      status_code = "HTTP_301"
    }
  }

  condition {
    host_header {
      values = [local.www_host]
    }
  }
}

# Apex + www DNS → the ALB. The apex MUST be an ALIAS (apex can't be a CNAME);
# both A and AAAA are needed because the ALB is dual-stack (IPv6-only clients
# would otherwise fail to resolve).
resource "aws_route53_record" "apex_a" {
  count   = var.serve_apex ? 1 : 0
  zone_id = local.hosted_zone_id
  name    = local.apex_host
  type    = "A"

  alias {
    name                   = aws_lb.main.dns_name
    zone_id                = aws_lb.main.zone_id
    evaluate_target_health = true
  }
}

resource "aws_route53_record" "apex_aaaa" {
  count   = var.serve_apex ? 1 : 0
  zone_id = local.hosted_zone_id
  name    = local.apex_host
  type    = "AAAA"

  alias {
    name                   = aws_lb.main.dns_name
    zone_id                = aws_lb.main.zone_id
    evaluate_target_health = true
  }
}

resource "aws_route53_record" "www_a" {
  count   = var.serve_apex ? 1 : 0
  zone_id = local.hosted_zone_id
  name    = local.www_host
  type    = "A"

  alias {
    name                   = aws_lb.main.dns_name
    zone_id                = aws_lb.main.zone_id
    evaluate_target_health = true
  }
}

resource "aws_route53_record" "www_aaaa" {
  count   = var.serve_apex ? 1 : 0
  zone_id = local.hosted_zone_id
  name    = local.www_host
  type    = "AAAA"

  alias {
    name                   = aws_lb.main.dns_name
    zone_id                = aws_lb.main.zone_id
    evaluate_target_health = true
  }
}
