locals {
  secret_values = {
    database-url                = var.database_url
    clerk-secret-key            = var.clerk_secret_key
    clerk-webhook-secret        = var.clerk_webhook_secret
    clerk-jwt-issuer            = var.clerk_jwt_issuer
    stripe-secret-key           = var.stripe_secret_key
    stripe-webhook-secret       = var.stripe_webhook_secret
    stripe-pro-monthly-price-id = var.stripe_pro_monthly_price_id
    stripe-pro-annual-price-id  = var.stripe_pro_annual_price_id
    gcs-bucket-name             = var.gcs_bucket_name
    cors-origins                = var.cors_origins
    frontend-url                = var.frontend_url
    langfuse-public-key         = var.langfuse_public_key
    langfuse-secret-key         = var.langfuse_secret_key
    langfuse-base-url           = var.langfuse_base_url
  }
}

resource "google_secret_manager_secret" "app" {
  for_each  = local.secret_values
  secret_id = each.key

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "app" {
  for_each = local.secret_values

  secret      = google_secret_manager_secret.app[each.key].id
  secret_data = each.value
}
