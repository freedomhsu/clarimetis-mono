output "backend_url" {
  description = "Cloud Run backend service URL"
  value       = google_cloud_run_v2_service.backend.uri
}

output "frontend_url" {
  description = "Cloud Run frontend service URL"
  value       = google_cloud_run_v2_service.frontend.uri
}

output "artifact_registry" {
  description = "Artifact Registry repository hostname"
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.clarimetis.repository_id}"
}

output "wif_provider" {
  description = "Workload Identity Federation provider — set as GHA secret WIF_PROVIDER"
  value       = google_iam_workload_identity_pool_provider.github.name
}

output "wif_service_account" {
  description = "GitHub Actions service account email — set as GHA secret WIF_SERVICE_ACCOUNT"
  value       = google_service_account.github_actions.email
}
