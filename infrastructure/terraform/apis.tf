# ── GCP API enablement ────────────────────────────────────────────────────────
#
# All APIs the project requires are declared here so each new environment
# (dev, staging, prod) gets them automatically on first `terraform apply`.
#
# On a brand-new project run this once before applying everything else:
#   terraform apply -target=google_project_service.apis
#
# disable_on_destroy = false prevents accidentally disabling a shared API when
# you tear down one environment inside the same project.

locals {
  required_apis = [
    # Infrastructure
    "run.googleapis.com",
    "artifactregistry.googleapis.com",
    "secretmanager.googleapis.com",
    "sqladmin.googleapis.com",
    "storage.googleapis.com",

    # IAM & auth
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "cloudresourcemanager.googleapis.com",

    # AI / ML
    "aiplatform.googleapis.com",

    # Voice features
    "speech.googleapis.com",
    "texttospeech.googleapis.com",
  ]
}

resource "google_project_service" "apis" {
  for_each = toset(local.required_apis)

  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}
