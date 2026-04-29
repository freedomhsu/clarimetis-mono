# ── Cloud Run service account ─────────────────────────────────────────────────

resource "google_service_account" "cloud_run" {
  account_id   = "clarimetis-cloud-run"
  display_name = "Clarimetis Cloud Run SA"
}

resource "google_project_iam_member" "cloud_run_secret_accessor" {
  project = var.project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${google_service_account.cloud_run.email}"
}

resource "google_project_iam_member" "cloud_run_storage" {
  project = var.project_id
  role    = "roles/storage.objectAdmin"
  member  = "serviceAccount:${google_service_account.cloud_run.email}"
}

resource "google_project_iam_member" "cloud_run_vertex_ai" {
  project = var.project_id
  role    = "roles/aiplatform.user"
  member  = "serviceAccount:${google_service_account.cloud_run.email}"
}

# ── Workload Identity Federation (keyless auth for GitHub Actions) ─────────────

resource "google_iam_workload_identity_pool" "github" {
  workload_identity_pool_id = "github-actions"
  display_name              = "GitHub Actions"
}

resource "google_iam_workload_identity_pool_provider" "github" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github-oidc"
  display_name                       = "GitHub OIDC"

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }

  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.actor"      = "assertion.actor"
    "attribute.repository" = "assertion.repository"
  }

  # Scope to this repo only — prevents other GitHub repos from using this pool
  attribute_condition = "assertion.repository == \"${var.github_repo}\""
}

# ── GitHub Actions service account ────────────────────────────────────────────

resource "google_service_account" "github_actions" {
  account_id   = "clarimetis-github-actions"
  display_name = "Clarimetis GitHub Actions SA"
}

# Allow the WIF principal (GitHub repo) to impersonate this SA
resource "google_service_account_iam_member" "github_wif_binding" {
  service_account_id = google_service_account.github_actions.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${var.github_repo}"
}

# Push images to Artifact Registry
resource "google_project_iam_member" "github_actions_ar_writer" {
  project = var.project_id
  role    = "roles/artifactregistry.writer"
  member  = "serviceAccount:${google_service_account.github_actions.email}"
}

# Deploy new Cloud Run revisions
resource "google_project_iam_member" "github_actions_run_developer" {
  project = var.project_id
  role    = "roles/run.developer"
  member  = "serviceAccount:${google_service_account.github_actions.email}"
}

# Required to attach a service account to Cloud Run during deploy
resource "google_project_iam_member" "github_actions_sa_user" {
  project = var.project_id
  role    = "roles/iam.serviceAccountUser"
  member  = "serviceAccount:${google_service_account.github_actions.email}"
}

# ── Frontend → Backend proxy auth ─────────────────────────────────────────────
# The frontend Cloud Run service calls the private backend via the Next.js proxy.
# Granting run.invoker here allows the frontend's service account to obtain a
# valid OIDC identity token and authenticate to the backend Cloud Run service.
resource "google_cloud_run_v2_service_iam_member" "frontend_invokes_backend" {
  name     = google_cloud_run_v2_service.backend.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.cloud_run.email}"
}
