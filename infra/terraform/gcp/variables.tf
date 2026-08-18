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
  default     = "1.35.6-gke.1250000"
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

variable "db_edition" {
  description = "Cloud SQL edition. Use ENTERPRISE for custom tiers or ENTERPRISE_PLUS for db-perf-optimized tiers."
  type        = string
  default     = "ENTERPRISE"

  validation {
    condition     = contains(["ENTERPRISE", "ENTERPRISE_PLUS"], var.db_edition)
    error_message = "db_edition must be ENTERPRISE or ENTERPRISE_PLUS."
  }
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

variable "db_max_connections" {
  description = "PostgreSQL max_connections enforced on the Cloud SQL instance. Must match the value documented in docs/autoscaling.md's connection-budget formulas (specs/007-pgbouncer-connection-pooling)."
  type        = number
  default     = 100
}

variable "enable_shard_output_rwx" {
  description = <<-EOT
    Provisions a Filestore instance (BASIC_HDD tier, the cheapest available --
    ~$0.20/GB-month, billed hourly) to back a ReadWriteMany PersistentVolume
    for `scripts/lab benchmark --in-cluster --parallel-shards N` with N > 1:
    every shard pod mounts the same /shard-output concurrently, which plain
    GCE PD storage classes (ReadWriteOnce only) cannot support. Opt-in
    (default false) so a lab that never needs more than 1 shard doesn't pay
    for storage it doesn't use. `scripts/lab provision-shard-storage`
    (docs/lab-cli.md) sets this true via a *targeted* apply against an
    already-`up` lab, rather than requiring a full `up` re-run. Torn down
    automatically by `scripts/lab down`'s `terraform destroy` like every
    other resource in this module -- no special-case cleanup needed.
  EOT
  type        = bool
  default     = false
}

variable "shard_output_capacity_gb" {
  description = "Filestore BASIC_HDD capacity in GiB for the RWX shard-output volume (enable_shard_output_rwx). 1024 is BASIC_HDD's minimum; the shard output itself (JSON summaries) is tiny, so this is sized at the tier floor, not for actual usage."
  type        = number
  default     = 1024

  validation {
    condition     = var.shard_output_capacity_gb >= 1024
    error_message = "shard_output_capacity_gb must be at least 1024 (BASIC_HDD's minimum)."
  }
}
