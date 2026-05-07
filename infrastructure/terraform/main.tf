# ── Prerequisites (run once per new environment) ──────────────────────────────
#
#   1. Create the GCP project and set the billing account:
#        gcloud projects create clarimetis-<env> --name="Clarimetis <Env>"
#        gcloud beta billing projects link clarimetis-<env> \
#          --billing-account=<BILLING_ACCOUNT_ID>
#
#   2. Create the GCS bucket for Terraform state (one per environment):
#        gcloud storage buckets create gs://clarimetis-tfstate-<env> \
#          --project=clarimetis-<env> --location=us-central1 \
#          --uniform-bucket-level-access
#
#   3. Copy env/staging.tfvars.example → env/staging.tfvars and fill in values.
#      (staging.tfvars is gitignored — never commit real secrets.)
#
#   4. Bootstrap APIs first (only needed on a brand-new project):
#        terraform init -backend-config="bucket=clarimetis-tfstate-<env>"
#        terraform apply -target=google_project_service.apis \
#          -var-file=env/<env>.tfvars
#
#   5. Apply everything else:
#        terraform apply -var-file=env/<env>.tfvars
#
#   Switching environments locally:
#        terraform init -reconfigure \
#          -backend-config="bucket=clarimetis-tfstate-staging"
#        terraform apply -var-file=env/staging.tfvars
#
#   All required APIs (including speech.googleapis.com and
#   texttospeech.googleapis.com) are declared in apis.tf — no manual
#   `gcloud services enable` needed.
#
#   NOTE: The backend "gcs" block below points to the dev state bucket by
#   default. Always pass -backend-config="bucket=clarimetis-tfstate-<env>"
#   when running `terraform init` for staging or prod so state is isolated.

terraform {
  required_version = ">= 1.7"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }

  backend "gcs" {
    bucket = "clarimetis-tfstate-dev-01"
    prefix = "terraform/state"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}
