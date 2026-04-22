# ── Cloud SQL (PostgreSQL) ────────────────────────────────────────────────────

resource "google_sql_database_instance" "main" {
  name             = "clarimetis-db-${var.environment}"
  database_version = "POSTGRES_16"
  region           = var.region

  deletion_protection = false

  settings {
    tier              = var.cloudsql_tier
    edition           = "ENTERPRISE"
    availability_type = "ZONAL"
    disk_size         = 10
    disk_autoresize   = false

    backup_configuration {
      enabled = false
    }

    ip_configuration {
      ipv4_enabled = true
    }
  }
}

resource "google_sql_database" "app" {
  name     = "wellness_db"
  instance = google_sql_database_instance.main.name
}

resource "google_sql_user" "app" {
  name     = "wellness"
  instance = google_sql_database_instance.main.name
  password = var.db_password
}

# Grant Cloud Run SA permission to connect to Cloud SQL
resource "google_project_iam_member" "cloud_run_cloudsql" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.cloud_run.email}"
}
