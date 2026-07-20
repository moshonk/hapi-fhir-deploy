output "cloud" {
  description = "Cloud provider name."
  value       = "gcp"
}

output "region" {
  description = "GCP region."
  value       = var.region
}

output "cluster_name" {
  description = "GKE cluster name."
  value       = google_container_cluster.lab.name
}

output "kubeconfig" {
  description = "Exec-auth kubeconfig for the GKE cluster."
  sensitive   = true
  value       = <<-YAML
    apiVersion: v1
    kind: Config
    clusters:
    - name: ${google_container_cluster.lab.name}
      cluster:
        server: https://${google_container_cluster.lab.endpoint}
        certificate-authority-data: ${google_container_cluster.lab.master_auth[0].cluster_ca_certificate}
    contexts:
    - name: ${google_container_cluster.lab.name}
      context:
        cluster: ${google_container_cluster.lab.name}
        user: ${google_container_cluster.lab.name}
    current-context: ${google_container_cluster.lab.name}
    users:
    - name: ${google_container_cluster.lab.name}
      user:
        exec:
          apiVersion: client.authentication.k8s.io/v1
          command: gke-gcloud-auth-plugin
          args: []
  YAML
}

output "database_endpoint" {
  description = "Cloud SQL private IP address."
  value       = google_sql_database_instance.postgres.private_ip_address
}

output "database_port" {
  description = "Cloud SQL PostgreSQL port."
  value       = 5432
}

output "database_name" {
  description = "FHIR database name."
  value       = google_sql_database.fhir.name
}

output "database_username" {
  description = "FHIR database username."
  value       = google_sql_user.fhir.name
}

output "database_password" {
  description = "Generated PostgreSQL password."
  sensitive   = true
  value       = random_password.postgres.result
}

output "node_size" {
  description = "GKE node machine type."
  value       = var.node_size
}

output "cluster_node_count" {
  description = "Initial GKE node count."
  value       = var.cluster_node_count
}

output "db_sku" {
  description = "Cloud SQL machine tier."
  value       = var.db_sku
}

output "resource_labels" {
  description = "Labels applied to supported GCP resources."
  value       = local.labels
}

output "ansible_metadata" {
  description = "Non-sensitive metadata for Ansible orchestration."
  value = {
    cloud               = "gcp"
    region              = var.region
    cluster_name        = google_container_cluster.lab.name
    database_endpoint   = google_sql_database_instance.postgres.private_ip_address
    database_port       = 5432
    database_name       = google_sql_database.fhir.name
    database_username   = google_sql_user.fhir.name
    postgres_version    = var.postgres_version
    node_size           = var.node_size
    cluster_node_count  = var.cluster_node_count
    database_secret     = "hapi-fhir-postgres"
    database_secret_key = "password"
    labels              = local.labels
  }
}
