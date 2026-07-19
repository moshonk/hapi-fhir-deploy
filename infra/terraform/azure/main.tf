locals {
  name = var.lab_name

  tags = merge(var.tags, {
    app        = "hapi-fhir"
    lab_name   = var.lab_name
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

resource "azurerm_resource_group" "lab" {
  name     = local.name
  location = var.region
  tags     = local.tags
}

resource "azurerm_virtual_network" "lab" {
  name                = "${local.name}-vnet"
  location            = azurerm_resource_group.lab.location
  resource_group_name = azurerm_resource_group.lab.name
  address_space       = ["10.50.0.0/16"]
  tags                = local.tags
}

resource "azurerm_subnet" "aks" {
  name                 = "aks"
  resource_group_name  = azurerm_resource_group.lab.name
  virtual_network_name = azurerm_virtual_network.lab.name
  address_prefixes     = ["10.50.0.0/20"]
}

resource "azurerm_subnet" "postgres" {
  name                 = "postgres"
  resource_group_name  = azurerm_resource_group.lab.name
  virtual_network_name = azurerm_virtual_network.lab.name
  address_prefixes     = ["10.50.16.0/24"]

  delegation {
    name = "postgres-flexible-server"

    service_delegation {
      name    = "Microsoft.DBforPostgreSQL/flexibleServers"
      actions = ["Microsoft.Network/virtualNetworks/subnets/join/action"]
    }
  }
}

resource "azurerm_private_dns_zone" "postgres" {
  name                = "privatelink.postgres.database.azure.com"
  resource_group_name = azurerm_resource_group.lab.name
  tags                = local.tags
}

resource "azurerm_private_dns_zone_virtual_network_link" "postgres" {
  name                  = "${local.name}-postgres"
  resource_group_name   = azurerm_resource_group.lab.name
  private_dns_zone_name = azurerm_private_dns_zone.postgres.name
  virtual_network_id    = azurerm_virtual_network.lab.id
  tags                  = local.tags
}

resource "azurerm_kubernetes_cluster" "lab" {
  name                = local.name
  location            = azurerm_resource_group.lab.location
  resource_group_name = azurerm_resource_group.lab.name
  dns_prefix          = local.name
  kubernetes_version  = var.kubernetes_version
  tags                = local.tags

  default_node_pool {
    name                 = "system"
    vm_size              = var.node_size
    node_count           = var.cluster_node_count
    auto_scaling_enabled = true
    min_count            = var.cluster_min_nodes
    max_count            = var.cluster_max_nodes
    vnet_subnet_id       = azurerm_subnet.aks.id
  }

  identity {
    type = "SystemAssigned"
  }

  network_profile {
    network_plugin = "azure"
    network_policy = "azure"
  }
}

resource "azurerm_postgresql_flexible_server" "postgres" {
  name                          = "${local.name}-postgres"
  resource_group_name           = azurerm_resource_group.lab.name
  location                      = azurerm_resource_group.lab.location
  version                       = var.postgres_version
  administrator_login           = var.database_username
  administrator_password        = random_password.postgres.result
  sku_name                      = var.db_sku
  storage_mb                    = var.db_storage_mb
  delegated_subnet_id           = azurerm_subnet.postgres.id
  private_dns_zone_id           = azurerm_private_dns_zone.postgres.id
  public_network_access_enabled = false
  backup_retention_days         = 7
  tags                          = local.tags

  depends_on = [
    azurerm_private_dns_zone_virtual_network_link.postgres
  ]
}

resource "azurerm_postgresql_flexible_server_database" "fhir" {
  name      = var.database_name
  server_id = azurerm_postgresql_flexible_server.postgres.id
  charset   = "UTF8"
  collation = "en_US.utf8"
}
