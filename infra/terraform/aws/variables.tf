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
  description = "AWS region for the EKS and RDS resources."
  type        = string
  default     = "us-east-1"
}

variable "kubernetes_version" {
  description = "EKS Kubernetes version."
  type        = string
  default     = "1.30"
}

variable "cluster_node_count" {
  description = "Desired number of EKS worker nodes."
  type        = number
  default     = 2

  validation {
    condition     = var.cluster_node_count >= 1 && var.cluster_node_count <= 10
    error_message = "cluster_node_count must be between 1 and 10."
  }
}

variable "cluster_min_nodes" {
  description = "Minimum EKS managed node group size."
  type        = number
  default     = 1
}

variable "cluster_max_nodes" {
  description = "Maximum EKS managed node group size."
  type        = number
  default     = 4
}

variable "node_size" {
  description = "EKS worker node instance type."
  type        = string
  default     = "m6i.large"
}

variable "postgres_version" {
  description = "RDS PostgreSQL major or minor engine version. Use PostgreSQL 16 or 17 only."
  type        = string
  default     = "16"

  validation {
    condition     = can(regex("^(16|17)(\\.[0-9]+)?$", var.postgres_version))
    error_message = "postgres_version must be PostgreSQL 16 or 17, optionally with a provider-supported minor version."
  }
}

variable "db_sku" {
  description = "RDS instance class for PostgreSQL."
  type        = string
  default     = "db.m6i.large"
}

variable "db_allocated_storage_gb" {
  description = "Allocated PostgreSQL storage in GiB."
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
  description = "Expected lab lifetime in hours, exposed as a tag for cleanup automation."
  type        = number
  default     = 8
}

variable "tags" {
  description = "Additional tags applied to supported AWS resources."
  type        = map(string)
  default     = {}
}
