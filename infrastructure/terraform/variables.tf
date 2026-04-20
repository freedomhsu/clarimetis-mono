variable "project_id" {
  description = "GCP project ID"
  type        = string
  default     = "clarimetis-dev-01"
}

variable "region" {
  description = "GCP region for all resources"
  type        = string
  default     = "us-central1"
}

variable "github_repo" {
  description = "GitHub repository in 'owner/repo' format (used to scope WIF)"
  type        = string
  default     = "freedomhsu/clarimetis-mono"
}

# ── Container images ────────────────────────────────────────────────────────
# Defaults point to :latest so first `terraform apply` works before CI/CD runs.
# CI/CD always pushes :latest so running `terraform apply` later is idempotent.

variable "backend_image" {
  description = "Fully-qualified backend container image (registry/repo/name:tag)"
  type        = string
  default     = "us-central1-docker.pkg.dev/clarimetis-dev-01/clarimetis/backend:latest"
}

variable "frontend_image" {
  description = "Fully-qualified frontend container image (registry/repo/name:tag)"
  type        = string
  default     = "us-central1-docker.pkg.dev/clarimetis-dev-01/clarimetis/frontend:latest"
}

# ── Secrets ─────────────────────────────────────────────────────────────────
# Pass these via terraform.tfvars (gitignored). Never hardcode here.

variable "database_url" {
  description = "PostgreSQL asyncpg connection string"
  type        = string
  sensitive   = true
}

variable "clerk_secret_key" {
  type      = string
  sensitive = true
}

variable "clerk_jwt_issuer" {
  type = string
}

variable "clerk_publishable_key" {
  description = "Clerk publishable key — baked into the frontend Docker image at build time"
  type        = string
}

variable "stripe_secret_key" {
  type      = string
  sensitive = true
}

variable "stripe_webhook_secret" {
  type      = string
  sensitive = true
}

variable "stripe_pro_monthly_price_id" {
  type = string
}

variable "stripe_pro_annual_price_id" {
  type = string
}

variable "gcs_bucket_name" {
  description = "GCS bucket for media uploads"
  type        = string
}

variable "cors_origins" {
  description = "Comma-separated list of allowed CORS origins"
  type        = string
  default     = "https://clarimetis.com"
}

variable "frontend_url" {
  description = "Public URL of the frontend (used in Stripe redirect URLs)"
  type        = string
  default     = "https://clarimetis.com"
}

variable "langfuse_public_key" {
  type    = string
  default = ""
}

variable "langfuse_secret_key" {
  type      = string
  sensitive = true
  default   = ""
}

variable "langfuse_base_url" {
  type    = string
  default = "https://us.cloud.langfuse.com"
}
