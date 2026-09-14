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
          apiVersion: client.authentication.k8s.io/v1beta1
          command: gke-gcloud-auth-plugin
          args: []
          interactiveMode: IfAvailable
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

output "database_connection_name" {
  description = "Cloud SQL instance connection name (PROJECT:REGION:INSTANCE), passed to `cloud-sql-proxy --psc` -- scripts/lab's backup-db/seed --restore-from-backup use this to reach the private-IP-only database from a host outside this lab's own VPC (google_compute_network.lab), which direct-IP connections to database_endpoint cannot do. GCP-only; aws/azure have no equivalent output."
  value       = google_sql_database_instance.postgres.connection_name
}

output "database_psc_service_attachment_link" {
  description = "Cloud SQL's Private Service Connect service attachment -- the target for a one-time, per-lab PSC consumer forwarding rule in the control-plane host's own network (scripts/lab's ensure_cloud_sql_psc_endpoint), which is what makes CLOUD_SQL_PROXY_BIN --psc actually reachable. Plain VPC peering can't substitute for this: Private Services Access (database_endpoint above) is itself a non-transitive peering, so a network peered only to google_compute_network.lab still can't reach it."
  value       = google_sql_database_instance.postgres.psc_service_attachment_link
}

output "database_psc_dns_name" {
  description = "Per-instance PSC DNS name (e.g. <uid>.<uid2>.<region>.sql.goog.) that `cloud-sql-proxy --psc` actually dials -- unlike --private-ip/default mode, PSC has no routable IP the proxy can use directly. scripts/lab's ensure_cloud_sql_psc_endpoint creates an A record for exactly this name (in a shared per-region private zone, <region>.sql.goog.) pointing at the PSC consumer forwarding rule's reserved IP, in the same control-plane network database_psc_service_attachment_link's forwarding rule lives in."
  value       = google_sql_database_instance.postgres.dns_name
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

output "db_edition" {
  description = "Cloud SQL edition."
  value       = var.db_edition
}

output "resource_labels" {
  description = "Labels applied to supported GCP resources."
  value       = local.labels
}

output "shard_output_filestore_ip" {
  description = "IP address of the optional Filestore instance backing the in-cluster k6 shard-output RWX PVC. Empty string if enable_shard_output_rwx is false (scripts/lab's provision-shard-storage checks for this)."
  value       = try(google_filestore_instance.shard_output[0].networks[0].ip_addresses[0], "")
}

output "shard_output_filestore_share_name" {
  description = "Filestore file share name for the shard-output RWX PVC. Empty string if enable_shard_output_rwx is false."
  value       = try(google_filestore_instance.shard_output[0].file_shares[0].name, "")
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
    db_edition          = var.db_edition
    node_size           = var.node_size
    cluster_node_count  = var.cluster_node_count
    database_secret     = "hapi-fhir-postgres"
    database_secret_key = "password"
    labels              = local.labels
  }
}
