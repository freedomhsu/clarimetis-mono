# ── Backend ───────────────────────────────────────────────────────────────────

resource "google_cloud_run_v2_service" "backend" {
  name                = "clarimetis-backend"
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = false

  template {
    service_account = google_service_account.cloud_run.email

    scaling {
      min_instance_count = 0
      max_instance_count = 10
    }

    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [google_sql_database_instance.main.connection_name]
      }
    }

    containers {
      image = var.backend_image

      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }

      ports {
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "1Gi"
        }
        cpu_idle = true
      }

      # ── Secrets from Secret Manager ───────────────────────────────────────
      dynamic "env" {
        for_each = {
          DATABASE_URL                = "database-url"
          CLERK_SECRET_KEY            = "clerk-secret-key"
          CLERK_WEBHOOK_SECRET        = "clerk-webhook-secret"
          CLERK_JWT_ISSUER            = "clerk-jwt-issuer"
          STRIPE_SECRET_KEY           = "stripe-secret-key"
          STRIPE_WEBHOOK_SECRET       = "stripe-webhook-secret"
          STRIPE_PRO_MONTHLY_PRICE_ID = "stripe-pro-monthly-price-id"
          STRIPE_PRO_ANNUAL_PRICE_ID  = "stripe-pro-annual-price-id"
          GCS_BUCKET_NAME             = "gcs-bucket-name"
          CORS_ORIGINS                = "cors-origins"
          FRONTEND_URL                = "frontend-url"
          LANGFUSE_PUBLIC_KEY         = "langfuse-public-key"
          LANGFUSE_SECRET_KEY         = "langfuse-secret-key"
          LANGFUSE_BASE_URL           = "langfuse-base-url"
        }
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.app[env.value].secret_id
              version = "latest"
            }
          }
        }
      }

      # ── Non-secret env vars ───────────────────────────────────────────────
      env {
        name  = "GCP_PROJECT_ID"
        value = var.project_id
      }
      env {
        name  = "GCP_LOCATION"
        value = var.region
      }
      env {
        name  = "GEMINI_FLASH_MODEL"
        value = "gemini-2.5-flash"
      }
      env {
        name  = "GEMINI_PRO_MODEL"
        value = "gemini-2.5-pro"
      }
    }
  }

  depends_on = [
    google_secret_manager_secret_version.app,
    google_project_iam_member.cloud_run_secret_accessor,
    google_project_iam_member.cloud_run_cloudsql,
    google_sql_database_instance.main,
  ]

  # CI/CD updates the image via `gcloud run deploy`; Terraform manages everything else.
  lifecycle {
    ignore_changes = [template[0].containers[0].image]
  }
}

# Blocked by org policy constraints/iam.allowedPolicyMemberTypes — needs org admin to
# run: gcloud org-policies reset constraints/iam.allowedPolicyMemberTypes --project=<id>
# resource "google_cloud_run_v2_service_iam_member" "backend_public" {
#   name     = google_cloud_run_v2_service.backend.name
#   location = var.region
#   role     = "roles/run.invoker"
#   member   = "allUsers"
# }

# ── Frontend ──────────────────────────────────────────────────────────────────

resource "google_cloud_run_v2_service" "frontend" {
  name                = "clarimetis-frontend"
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = false

  template {
    service_account = google_service_account.cloud_run.email

    scaling {
      min_instance_count = 0
      max_instance_count = 5
    }

    containers {
      image = var.frontend_image

      ports {
        container_port = 3000
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
        cpu_idle = true
      }

      # CLERK_SECRET_KEY is needed at runtime by Clerk's server-side auth.
      # NEXT_PUBLIC_* vars are baked into the image at Docker build time.
      dynamic "env" {
        for_each = {
          CLERK_SECRET_KEY = "clerk-secret-key"
        }
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.app[env.value].secret_id
              version = "latest"
            }
          }
        }
      }

      env {
        name  = "NEXT_PUBLIC_CLERK_SIGN_IN_URL"
        value = "/sign-in"
      }
      env {
        name  = "NEXT_PUBLIC_CLERK_SIGN_UP_URL"
        value = "/sign-up"
      }
      env {
        name  = "NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL"
        value = "/dashboard"
      }
      env {
        name  = "NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL"
        value = "/dashboard"
      }

      # Server-side env var consumed by the Next.js proxy route handler.
      # Not NEXT_PUBLIC_ — never exposed to the browser.
      env {
        name  = "BACKEND_URL"
        value = google_cloud_run_v2_service.backend.uri
      }
    }
  }

  depends_on = [
    google_cloud_run_v2_service.backend,
    google_secret_manager_secret_version.app,
    google_project_iam_member.cloud_run_secret_accessor,
  ]

  lifecycle {
    ignore_changes = [template[0].containers[0].image]
  }
}

# resource "google_cloud_run_v2_service_iam_member" "frontend_public" {
#   name     = google_cloud_run_v2_service.frontend.name
#   location = var.region
#   role     = "roles/run.invoker"
#   member   = "allUsers"
# }

# ── Custom domain mapping (no load balancer required) ─────────────────────────
# Maps var.custom_domain → the frontend Cloud Run service.
# Google auto-provisions and renews the TLS certificate.
#
# Prerequisites (run once before applying):
#   gcloud domains verify <domain> --project=<project_id>
#
# After apply, Terraform outputs the DNS records to add to your registrar.
# Use a CNAME record pointing staging.clarimetis.com → ghs.googlehosted.com.
#
# Leave custom_domain="" in tfvars to skip this resource entirely.
resource "google_cloud_run_domain_mapping" "frontend" {
  count    = var.custom_domain != "" ? 1 : 0
  location = var.region
  name     = var.custom_domain

  metadata {
    namespace = var.project_id
  }

  spec {
    route_name = google_cloud_run_v2_service.frontend.name
  }

  depends_on = [google_cloud_run_v2_service.frontend]
}
