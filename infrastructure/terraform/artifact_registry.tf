resource "google_artifact_registry_repository" "clarimetis" {
  location      = var.region
  repository_id = "clarimetis"
  description   = "Clarimetis container images"
  format        = "DOCKER"
}
