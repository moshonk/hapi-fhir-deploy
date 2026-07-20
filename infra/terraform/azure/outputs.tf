output "cloud" {
  description = "Cloud provider name."
  value       = "azure"
}

output "region" {
  description = "Azure region."
  value       = var.region
}

output "cluster_name" {
  description = "AKS cluster name."
  value       = azurerm_kubernetes_cluster.lab.name
}

output "kubeconfig" {
  description = "AKS kubeconfig."
  sensitive   = true
  value       = azurerm_kubernetes_cluster.lab.kube_config_raw
}

output "database_endpoint" {
  description = "Azure PostgreSQL Flexible Server FQDN."
  value       = azurerm_postgresql_flexible_server.postgres.fqdn
}

output "database_port" {
  description = "Azure PostgreSQL port."
  value       = 5432
}

output "database_name" {
  description = "FHIR database name."
  value       = azurerm_postgresql_flexible_server_database.fhir.name
}

output "database_username" {
  description = "FHIR database username."
  value       = azurerm_postgresql_flexible_server.postgres.administrator_login
}

output "database_password" {
  description = "Generated PostgreSQL password."
  sensitive   = true
  value       = random_password.postgres.result
}

output "node_size" {
  description = "AKS node VM size."
  value       = var.node_size
}

output "cluster_node_count" {
  description = "Initial AKS node count."
  value       = var.cluster_node_count
}

output "db_sku" {
  description = "Azure PostgreSQL Flexible Server SKU."
  value       = var.db_sku
}

output "resource_tags" {
  description = "Tags applied to lab resources."
  value       = local.tags
}

output "ansible_metadata" {
  description = "Non-sensitive metadata for Ansible orchestration."
  value = {
    cloud               = "azure"
    region              = var.region
    cluster_name        = azurerm_kubernetes_cluster.lab.name
    database_endpoint   = azurerm_postgresql_flexible_server.postgres.fqdn
    database_port       = 5432
    database_name       = azurerm_postgresql_flexible_server_database.fhir.name
    database_username   = azurerm_postgresql_flexible_server.postgres.administrator_login
    postgres_version    = var.postgres_version
    node_size           = var.node_size
    cluster_node_count  = var.cluster_node_count
    database_secret     = "hapi-fhir-postgres"
    database_secret_key = "password"
    tags                = local.tags
  }
}
