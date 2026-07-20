# Ansible Benchmark Lab Orchestration

These playbooks deploy the HAPI FHIR Helm baseline onto a Kubernetes cluster after Terraform has provisioned the provider-specific infrastructure.

The workflow is provider-neutral once `KUBECONFIG` points at the target cluster:

```sh
python3 -m pip install -r ansible/requirements.txt
ansible-galaxy collection install -r ansible/requirements.yml
export KUBECONFIG=/path/to/lab.kubeconfig
export HAPI_FHIR_POSTGRES_PASSWORD='replace-at-runtime'

ansible-playbook -i ansible/inventory.ini ansible/playbooks/lab.yml \
  -e hapi_database_host=hapi-fhir-postgres.example.internal
```

When issue #19 Terraform outputs are available, write them to a local ignored file and let Ansible derive the endpoint, username, database, and password:

```sh
terraform -chdir=infra/terraform/aws output -json > ansible/artifacts/terraform-aws.json
ansible-playbook -i ansible/inventory.ini ansible/playbooks/lab.yml \
  -e terraform_output_file=ansible/artifacts/terraform-aws.json
```

Do not commit generated kubeconfigs, Terraform output JSON, runtime values, metadata output, or real database passwords. `ansible/artifacts/` is ignored except for its placeholder.

## Playbooks

- `playbooks/00-install-addons.yml`: installs pinned Prometheus Operator, Metrics Server, and KEDA chart releases.
- `playbooks/20-deploy-hapi-fhir.yml`: creates the runtime PostgreSQL Secret, builds Helm dependencies, installs or upgrades HAPI FHIR, patches rollout controls, and applies autoscaling.
- `playbooks/30-wait-readiness.yml`: waits for HAPI, exporter, KEDA, Metrics Server, ServiceMonitor, ScaledObject, and metrics APIs.
- `playbooks/40-collect-metadata.yml`: writes non-sensitive deployment metadata to `ansible/artifacts/deployment-metadata.json`.
- `playbooks/lab.yml`: runs the full add-ons, deploy, wait, and metadata workflow.

## Runtime Inputs

The deployment requires:

- `KUBECONFIG` or `lab_kubeconfig`.
- `hapi_database_host` or `terraform_output_file` containing `database_endpoint.value`.
- `hapi_database_password`, `HAPI_FHIR_POSTGRES_PASSWORD`, or `terraform_output_file` containing `database_password.value`.

Optional overrides include `hapi_database_port`, `hapi_database_name`, `hapi_database_username`, `install_prometheus_stack`, `install_metrics_server`, `install_keda`, and `apply_autoscaling`.
