# Terraform Benchmark Lab Modules

These Terraform modules provision ephemeral Kubernetes and managed PostgreSQL infrastructure for the HAPI FHIR benchmark lab tracked by issue #19.

The modules are root-capable and can be run directly:

```sh
terraform -chdir=infra/terraform/aws init
terraform -chdir=infra/terraform/aws plan

terraform -chdir=infra/terraform/azure init
terraform -chdir=infra/terraform/azure plan

terraform -chdir=infra/terraform/gcp init
terraform -chdir=infra/terraform/gcp plan
```

## Provider Coverage

| Cloud | Kubernetes | Managed PostgreSQL |
| --- | --- | --- |
| AWS | EKS managed node group | RDS PostgreSQL |
| Azure | AKS system node pool | Azure Database for PostgreSQL Flexible Server |
| GCP | GKE standard cluster and node pool | Cloud SQL for PostgreSQL |

Each module supports configurable region, Kubernetes version, cluster size, node size, PostgreSQL 16 or 17, database SKU, and TTL/lab tags or labels.

## Outputs For Ansible

Each module emits:

- `kubeconfig`: sensitive kubeconfig content for the new cluster.
- `database_endpoint`: managed PostgreSQL host.
- `database_port`: PostgreSQL port, `5432`.
- `database_name`: default `hapi_fhir`.
- `database_username`: default `hapi_fhir`.
- `database_password`: sensitive generated password.
- `ansible_metadata`: non-sensitive deployment metadata that orchestration can consume without committing secrets.

Do not commit real `*.tfvars`, Terraform state, generated kubeconfigs, or output files. The repository ignores those paths by default.

## Validation

Run formatting and validation after changing these modules:

```sh
terraform fmt -check -recursive infra/terraform
terraform -chdir=infra/terraform/aws init -backend=false
terraform -chdir=infra/terraform/aws validate
terraform -chdir=infra/terraform/azure init -backend=false
terraform -chdir=infra/terraform/azure validate
terraform -chdir=infra/terraform/gcp init -backend=false
terraform -chdir=infra/terraform/gcp validate
```

Provider downloads require network access during `terraform init`.
