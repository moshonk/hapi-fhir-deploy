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

  # ABANDON: GCP keeps the peering "in use" for a while after the Cloud SQL
  # instance is deleted. Tearing down hapi-lab-t3 (2026-09-12) failed on
  # "Failed to delete connection; Producer services (e.g. CloudSQL) are
  # still using this connection" immediately after the instance was gone,
  # stranding the network and address range. Abandoning it lets `down`
  # finish; GCP releases the peering when the producer does, and deleting
  # the network removes it. Same pattern as the SQL database/user below.
  deletion_policy = "ABANDON"
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

    # Root-caused live: Filestore's default export squashes root (client
    # UID 0 is remapped to an unprivileged anonymous user on the NFS
    # server side) -- so even a k6 shard pod's initContainer running AS
    # root got "Operation not permitted" trying to chmod the freshly
    # mounted, root:root-owned share, and every shard failed to write its
    # results. NO_ROOT_SQUASH removes that remapping for this share, which
    # is fine here: it's a throwaway, single-purpose benchmark-output
    # volume with no sensitive data, not a general-purpose one.
    # ip_ranges scopes this to the lab's own node subnet (google_compute
    # subnetwork.lab's primary CIDR) -- NFS mounts happen at the GKE NODE
    # level (kubelet mounts once, then bind-mounts into each pod), so the
    # node's own subnet range is what needs export access, not the pods/
    # services secondary ranges.
    nfs_export_options {
      ip_ranges   = [google_compute_subnetwork.lab.ip_cidr_range]
      access_mode = "READ_WRITE"
      squash_mode = "NO_ROOT_SQUASH"
    }
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

      # Private Service Connect, alongside (not instead of) the VPC-peering
      # private IP above -- backup-db/seed --restore-from-backup run from
      # the Lab Control UI's control-plane host, which lives in a
      # DIFFERENT, unpeered VPC (docs/lab-cli.md). Plain VPC peering
      # between that network and google_compute_network.lab can't reach
      # database_endpoint either: Private Services Access (how the private
      # IP above is allocated) is itself implemented as a peering to a
      # Google-managed tenant network, and VPC Network Peering is
      # explicitly non-transitive -- confirmed live (a direct
      # default<->lab peering was traced back to this exact limitation
      # before being created). PSC's service attachment doesn't have that
      # restriction, which is the whole reason it exists. Same-project
      # only for now (allowed_consumer_projects); this repo's control
      # plane and every lab it manages always share one project.
      psc_config {
        psc_enabled               = true
        allowed_consumer_projects = [var.project_id]
      }
    }

    backup_configuration {
      enabled = true
    }

    database_flags {
      name  = "max_connections"
      value = tostring(var.db_max_connections)
    }

    # Opt-in only (db_work_mem_kb = 0 leaves the flag unset entirely, so
    # PostgreSQL's own 4MB default applies). See the variable's own
    # description for the measured regression that makes this deliberately
    # off by default rather than "tuned up because bigger sounds better".
    dynamic "database_flags" {
      for_each = var.db_work_mem_kb > 0 ? [var.db_work_mem_kb] : []
      content {
        name  = "work_mem"
        value = tostring(database_flags.value)
      }
    }

    # Query Insights (no extra cost at this sampling level): enabled to
    # diagnose a live finding from the load-profile benchmark (docs/
    # autoscaling.md "Tail latency") -- Prometheus's hikaricp_connections_
    # usage_seconds_max / http_server_requests_seconds_max showed a handful
    # of requests per run holding a Postgres connection for 60-140s+, on
    # both the native and PgBouncer tiers, well past k6's own 60s default
    # request timeout (which was silently truncating/hiding the real tail).
    # pg_stat_statements is not installed and Query Insights was previously
    # off, so neither could attribute this to a specific query -- this flag
    # turns Query Insights on so the next benchmark run's slow/lock-waiting
    # queries are captured for inspection in Cloud SQL's Query Insights UI.
    insights_config {
      query_insights_enabled  = true
      query_string_length     = 1024
      record_application_tags = true
      # Cloud SQL rejects record_client_address = true outright once PSC
      # connectivity is enabled below ("Insights record client address is
      # not supported for instances with PSC connectivity enabled", a real
      # 400 hit live applying the psc_config change) -- query text/tags/
      # plans (the fields this was actually added to diagnose, see above)
      # are unaffected; only the connecting client's IP goes unrecorded.
      record_client_address = false
    }
  }

  deletion_protection = false

  depends_on = [
    google_project_service.sqladmin,
    google_service_networking_connection.private_service
  ]
}

resource "google_sql_database_instance" "postgres_replica" {
  count = var.enable_read_replica ? 1 : 0

  name                 = "${local.name}-postgres-replica"
  region               = var.region
  database_version     = "POSTGRES_${var.postgres_version}"
  master_instance_name = google_sql_database_instance.postgres.name

  replica_configuration {
    failover_target = false
  }

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

      psc_config {
        psc_enabled               = true
        allowed_consumer_projects = [var.project_id]
      }
    }
  }

  deletion_protection = false

  depends_on = [
    google_sql_database_instance.postgres
  ]
}

resource "google_sql_database" "fhir" {
  name     = var.database_name
  instance = google_sql_database_instance.postgres.name

  # ABANDON: on destroy, drop this from state instead of issuing DROP
  # DATABASE; deleting google_sql_database_instance.postgres removes it
  # anyway. Root-caused live tearing down hapi-lab-t3 (2026-09-12): the
  # GKE cluster -- and HAPI/PgBouncer still connected to this database --
  # is destroyed in parallel with it, so Cloud SQL refused with "database
  # hapi_fhir is being accessed by other users" and `down` stopped with the
  # instance (and its bill) still running.
  deletion_policy = "ABANDON"
}

resource "google_sql_user" "fhir" {
  name     = var.database_username
  instance = google_sql_database_instance.postgres.name
  password = random_password.postgres.result

  # ABANDON: PostgreSQL will not drop a role that still owns objects, and
  # this role owns every HAPI table. The same hapi-lab-t3 teardown's retry
  # failed with 'role "hapi_fhir" cannot be dropped because some objects
  # depend on it -- 106 objects in database hapi_fhir'. Instance deletion
  # removes the role and everything it owns, so there is nothing for
  # Terraform to delete here.
  deletion_policy = "ABANDON"
}
