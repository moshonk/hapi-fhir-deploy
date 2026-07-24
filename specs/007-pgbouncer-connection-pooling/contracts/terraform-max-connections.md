# Contract: `db_max_connections` Terraform Variable

## Purpose

Enforce, rather than merely document, the PostgreSQL connection limit that both the native and pooled connection-budget formulas depend on. Today none of the three cloud modules set this — confirmed by reading `infra/terraform/{aws,azure,gcp}/main.tf` directly (no `database_flags` block on the GCP `google_sql_database_instance`, no `aws_db_parameter_group` resource, no `azurerm_postgresql_flexible_server_configuration` resource).

## Variable definition (added identically to each module's `variables.tf`)

```hcl
variable "db_max_connections" {
  description = "PostgreSQL max_connections enforced on the provisioned instance. Must match the value documented in docs/autoscaling.md."
  type        = number
  default     = 100
}
```

The default of `100` preserves today's documented (if previously unenforced) assumption, so existing lab runs that don't override this variable see no behavior change other than the value now being real instead of assumed.

## Per-cloud wiring

| Cloud | File | Mechanism |
| --- | --- | --- |
| GCP | `infra/terraform/gcp/main.tf` | `google_sql_database_instance.settings.database_flags { name = "max_connections", value = var.db_max_connections }` |
| AWS | `infra/terraform/aws/main.tf` | New `aws_db_parameter_group` resource with a `max_connections` parameter, referenced via `aws_db_instance.parameter_group_name` |
| Azure | `infra/terraform/azure/main.tf` | New `azurerm_postgresql_flexible_server_configuration` resource named `max_connections`, `value = var.db_max_connections` |

## Invariants

1. `var.db_max_connections` MUST be the single source of truth `docs/autoscaling.md` references for `postgres_max_connections` in both the native and pooled formulas — no formula input may hardcode a literal that could drift from the provisioned value.
2. Changing `db_max_connections` and reprovisioning MUST result in the new value being enforced on the live database instance, verifiable by inspection (spec 007 SC-003), not just in Terraform state.
3. This variable's default MUST NOT silently change the native tier's already-Implemented ceiling (`floor((100-50)/10) = 5`) — default stays `100`, matching the value the existing CI guardrail already hardcodes.
