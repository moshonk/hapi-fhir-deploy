variable "lab_name" {
  description = "Name prefix for benchmark lab resources."
  type        = string
  default     = "hapi-fhir-bench"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,31}$", var.lab_name))
    error_message = "lab_name must be 3-32 characters, start with a lowercase letter, and contain only lowercase letters, numbers, and hyphens."
  }
}

variable "region" {
  description = "Azure region for the AKS and PostgreSQL resources."
  type        = string
  default     = "eastus"
}

variable "kubernetes_version" {
  description = "AKS Kubernetes version."
  type        = string
  default     = "1.30"
}

variable "cluster_node_count" {
  description = "Initial AKS node count."
  type        = number
  default     = 2

  validation {
    condition     = var.cluster_node_count >= 1 && var.cluster_node_count <= 10
    error_message = "cluster_node_count must be between 1 and 10."
  }
}

variable "cluster_min_nodes" {
  description = "Minimum AKS node count when autoscaling is enabled."
  type        = number
  default     = 1
}

variable "cluster_max_nodes" {
  description = "Maximum AKS node count when autoscaling is enabled."
  type        = number
  default     = 4
}

variable "node_size" {
  description = "AKS node VM size."
  type        = string
  default     = "Standard_D4s_v5"
}

variable "postgres_version" {
  description = "Azure PostgreSQL Flexible Server major version. Use PostgreSQL 16 or 17 only."
  type        = string
  default     = "16"

  validation {
    condition     = contains(["16", "17"], var.postgres_version)
    error_message = "postgres_version must be 16 or 17."
  }
}

variable "db_sku" {
  description = "Azure PostgreSQL Flexible Server SKU."
  type        = string
  default     = "GP_Standard_D2ds_v5"
}

variable "db_storage_mb" {
  description = "Azure PostgreSQL storage size in MiB."
  type        = number
  default     = 131072
}

variable "database_name" {
  description = "FHIR database name."
  type        = string
  default     = "hapi_fhir"
}

variable "database_username" {
  description = "FHIR database username."
  type        = string
  default     = "hapi_fhir"
}

variable "ttl_hours" {
  description = "Expected lab lifetime in hours, exposed as a tag for cleanup automation."
  type        = number
  default     = 8
}

variable "tags" {
  description = "Additional tags applied to Azure resources."
  type        = map(string)
  default     = {}
}
