variable "project_id" {
  description = "GCP project ID for GKE and Cloud SQL resources."
  type        = string
}

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
  description = "GCP region for the GKE and Cloud SQL resources."
  type        = string
  default     = "us-central1"
}

variable "zone" {
  description = "GCP zone used as the GKE node pool location."
  type        = string
  default     = "us-central1-a"
}

variable "kubernetes_version" {
  description = "GKE Kubernetes version."
  type        = string
  default     = "1.30"
}

variable "cluster_node_count" {
  description = "Initial GKE node count."
  type        = number
  default     = 2

  validation {
    condition     = var.cluster_node_count >= 1 && var.cluster_node_count <= 10
    error_message = "cluster_node_count must be between 1 and 10."
  }
}

variable "cluster_min_nodes" {
  description = "Minimum GKE node pool size."
  type        = number
  default     = 1
}

variable "cluster_max_nodes" {
  description = "Maximum GKE node pool size."
  type        = number
  default     = 4
}

variable "node_size" {
  description = "GKE node machine type."
  type        = string
  default     = "e2-standard-4"
}

variable "postgres_version" {
  description = "Cloud SQL PostgreSQL major version. Use PostgreSQL 16 or 17 only."
  type        = string
  default     = "16"

  validation {
    condition     = contains(["16", "17"], var.postgres_version)
    error_message = "postgres_version must be 16 or 17."
  }
}

variable "db_sku" {
  description = "Cloud SQL machine tier."
  type        = string
  default     = "db-custom-2-7680"
}

variable "db_disk_size_gb" {
  description = "Cloud SQL disk size in GiB."
  type        = number
  default     = 100
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
  description = "Expected lab lifetime in hours, exposed as a label for cleanup automation."
  type        = number
  default     = 8
}

variable "labels" {
  description = "Additional labels applied to supported GCP resources."
  type        = map(string)
  default     = {}
}
