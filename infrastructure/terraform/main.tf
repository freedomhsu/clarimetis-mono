# ── Prerequisites (run once before terraform init) ────────────────────────────
#
#   1. Create the GCS bucket for Terraform state:
#        gcloud storage buckets create gs://clarimetis-tfstate-dev-01 \
#          --project=clarimetis-dev-01 --location=us-central1 \
#          --uniform-bucket-level-access
#
#   2. Enable required APIs:
#        gcloud services enable \
#          run.googleapis.com \
#          artifactregistry.googleapis.com \
#          secretmanager.googleapis.com \
#          iam.googleapis.com \
#          iamcredentials.googleapis.com \
#          cloudresourcemanager.googleapis.com \
#          --project=clarimetis-dev-01
#
#   3. Copy terraform.tfvars.example → terraform.tfvars and fill in values.
#
#   4. terraform init && terraform apply

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
