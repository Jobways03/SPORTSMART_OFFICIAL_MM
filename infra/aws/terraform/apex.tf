# Apex serving — gated on var.serve_apex (production only; staging keeps the
# wildcard cert + per-subdomain records and these resources are absent).
#
# Serves the customer storefront (web-storefront) at the BARE APEX env_domain
# (e.g. https://sportsmart.com) and 301-redirects www → apex. The bare-apex ACM
# SAN is added in alb.tf (a wildcard *.<domain> does not cover the apex); www is
# already covered by the wildcard cert.
#
# DNS IS DELIBERATELY NOT MANAGED HERE. The apex + www A/AAAA records are
# operator-managed directly in Route53 so go-live is a single, controlled,
# instantly-reversible MANUAL flip (Shopify IP → this ALB, and back on rollback),
# independent of `terraform apply`. Terraform only makes the ALB ABLE to serve
# the apex (cert SAN + host-header rules + CORS); pointing DNS at it is the manual
# cutover step. See docs/runbooks/PRODUCTION_APEX_CUTOVER.md (Phase 5) and
# docs/runbooks/PRODUCTION_TERRAFORM_APPLY.md.

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
# (Reaches the ALB only once the operator points www's DNS at it — see header.)
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
