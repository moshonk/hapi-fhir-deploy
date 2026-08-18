locals {
  name = var.lab_name

  labels = merge(var.labels, {
    app        = "hapi-fhir"
    lab_name   = replace(var.lab_name, "-", "_")
    managed_by = "terraform"
    ttl_hours  = tostring(var.ttl_hours)
    workload   = "benchmark"
  })
}

resource "random_password" "postgres" {
  length           = 32
  special          = true
  override_special = "_%@"
}

resource "google_project_service" "container" {
  service            = "container.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "sqladmin" {
  service            = "sqladmin.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "servicenetworking" {
  service            = "servicenetworking.googleapis.com"
  disable_on_destroy = false
}

# Always enabled (like the other google_project_service resources above) --
# enabling an unused API costs nothing, unlike the Filestore instance itself
# (google_filestore_instance.shard_output below), which stays opt-in via
# var.enable_shard_output_rwx.
resource "google_project_service" "file" {
  service            = "file.googleapis.com"
  disable_on_destroy = false
}

resource "google_compute_network" "lab" {
  name                    = local.name
  auto_create_subnetworks = false

  depends_on = [
    google_project_service.container
  ]
}

resource "google_compute_subnetwork" "lab" {
  name          = "${local.name}-subnet"
  region        = var.region
  network       = google_compute_network.lab.id
  ip_cidr_range = "10.60.0.0/20"

  secondary_ip_range {
    range_name    = "pods"
    ip_cidr_range = "10.64.0.0/14"
  }

  secondary_ip_range {
    range_name    = "services"
    ip_cidr_range = "10.68.0.0/20"
  }
}

resource "google_compute_global_address" "private_service" {
  name          = "${local.name}-private-service"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 16
  network       = google_compute_network.lab.id

  depends_on = [
    google_project_service.servicenetworking
  ]
}

resource "google_service_networking_connection" "private_service" {
  network                 = google_compute_network.lab.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_service.name]
}

resource "google_container_cluster" "lab" {
  name                     = local.name
  location                 = var.region
  min_master_version       = var.kubernetes_version
  network                  = google_compute_network.lab.id
  subnetwork               = google_compute_subnetwork.lab.id
  remove_default_node_pool = true
  initial_node_count       = 1
  deletion_protection      = false

  ip_allocation_policy {
    cluster_secondary_range_name  = "pods"
    services_secondary_range_name = "services"
  }

  resource_labels = local.labels

  depends_on = [
    google_project_service.container
  ]
}

resource "google_container_node_pool" "lab" {
  name           = "${local.name}-workers"
  cluster        = google_container_cluster.lab.name
  location       = google_container_cluster.lab.location
  node_count     = var.cluster_node_count
  node_locations = [var.zone]
  version        = var.kubernetes_version

  autoscaling {
    min_node_count = var.cluster_min_nodes
    max_node_count = var.cluster_max_nodes
  }

  node_config {
    machine_type = var.node_size
    labels       = local.labels

    oauth_scopes = [
      "https://www.googleapis.com/auth/cloud-platform"
    ]
  }
}

# Backs the ReadWriteMany PVC scripts/lab benchmark --in-cluster
# --parallel-shards N (N > 1) needs -- see variables.tf's
# enable_shard_output_rwx doc comment. Statically bound to a
# PersistentVolume (manifests/k6-shard-job/echis-shard-output-pv.yaml,
# applied by `scripts/lab provision-shard-storage`) via the core `nfs`
# volume plugin, NOT the Filestore CSI driver -- no GKE addon/cluster
# change needed, this is purely additive infrastructure. Zonal (not
# regional) to match google_container_node_pool.lab's own var.zone.
resource "google_filestore_instance" "shard_output" {
  count = var.enable_shard_output_rwx ? 1 : 0

  name = "${local.name}-shard-output"
  # `zone` is deprecated on this resource (provider warning: "Use `location`
  # instead") -- `location` takes the same zone string for BASIC_HDD/BASIC_SSD
  # (zonal) instances, matching google_container_node_pool.lab's own var.zone.
  location = var.zone
  tier     = "BASIC_HDD"

  file_shares {
    name        = "shard_output"
    capacity_gb = var.shard_output_capacity_gb
  }

  networks {
    network      = google_compute_network.lab.name
    modes        = ["MODE_IPV4"]
    connect_mode = "DIRECT_PEERING"
  }

  labels = local.labels

  depends_on = [
    google_project_service.file
  ]
}

resource "google_sql_database_instance" "postgres" {
  name             = "${local.name}-postgres"
  region           = var.region
  database_version = "POSTGRES_${var.postgres_version}"

  settings {
    tier              = var.db_sku
    edition           = var.db_edition
    availability_type = "ZONAL"
    disk_size         = var.db_disk_size_gb
    disk_type         = "PD_SSD"
    user_labels       = local.labels

    ip_configuration {
      ipv4_enabled    = false
      private_network = google_compute_network.lab.id
    }

    backup_configuration {
      enabled = true
    }

    database_flags {
      name  = "max_connections"
      value = tostring(var.db_max_connections)
    }
  }

  deletion_protection = false

  depends_on = [
    google_project_service.sqladmin,
    google_service_networking_connection.private_service
  ]
}

resource "google_sql_database" "fhir" {
  name     = var.database_name
  instance = google_sql_database_instance.postgres.name
}

resource "google_sql_user" "fhir" {
  name     = var.database_username
  instance = google_sql_database_instance.postgres.name
  password = random_password.postgres.result
}
