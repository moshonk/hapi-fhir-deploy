# Benchmark Lab Epic Closeout

This document maps the ephemeral multi-cloud HAPI FHIR benchmark lab epic to the committed implementation. It is intended as the acceptance handoff for issue #18 and as a quick inventory for future changes.

## Acceptance Matrix

| Epic acceptance criterion | Committed support |
| --- | --- |
| Can run provision -> deploy -> seed -> benchmark -> report -> destroy. | `scripts/lab` exposes `up`, `deploy`, `seed`, `benchmark`, `report`, and `down`; [benchmark-lab-runbook.md](benchmark-lab-runbook.md) documents the smoke path end to end. |
| Supports AWS, Azure, and GCP. | `infra/terraform/aws`, `infra/terraform/azure`, and `infra/terraform/gcp` provision provider-native Kubernetes and managed PostgreSQL, and `scripts/lab --cloud aws|azure|gcp` routes to each provider. |
| Produces analyzable local benchmark artifacts. | `scripts/lab seed` writes dataset metadata, `scripts/lab benchmark` writes k6 summaries/raw JSONL, and `scripts/lab report` publishes ignored `results/YYYYMMDD-HHMMSS-provider-profile/` directories with raw artifacts, `summary.csv`, `environment.json`, `report.md`, optional `index.html`, and Prometheus context. |
| Keeps secrets out of the repo. | Terraform state, kubeconfigs, tfvars, Ansible artifacts, and `results/` are ignored; Terraform kubeconfig and database password outputs are sensitive; the result publisher derives non-sensitive environment fields without copying raw Terraform output JSON. |

## Workstream Inventory

| Workstream | Primary artifacts |
| --- | --- |
| Terraform infrastructure | `infra/terraform/{aws,azure,gcp}/` |
| Deployment orchestration | `ansible/playbooks/lab.yml`, `ansible/playbooks/00-install-addons.yml`, `ansible/playbooks/20-deploy-hapi-fhir.yml`, `ansible/playbooks/30-wait-readiness.yml`, `ansible/playbooks/40-collect-metadata.yml` |
| Lab wrapper | `scripts/lab` |
| Synthea data seeding | `benchmarks/synthea/synthea.properties`, `scripts/synthea_loader.rb` |
| k6 benchmark profiles | `benchmarks/k6/{smoke,baseline,load,stress}.js`, `benchmarks/k6/lib/fhir_benchmark.js` |
| Result publishing | `scripts/publish_results.rb`, `test/publish_results_test.rb` |
| Safety and methodology docs | `docs/benchmark-lab-runbook.md`, `docs/lab-cli.md` |

## Operator Path

Use the runbook for the detailed procedure. At a high level:

```sh
scripts/lab up --cloud aws|azure|gcp --name NAME --auto-approve --var ttl_hours=4
scripts/lab deploy --cloud aws|azure|gcp --name NAME
FHIR_BASE_URL=http://localhost:8080/fhir scripts/lab seed --patients 25 --seed 12345 --run RUN_ID
FHIR_BASE_URL=http://localhost:8080/fhir scripts/lab benchmark --profile smoke --run RUN_ID
scripts/lab report --run RUN_ID --cloud aws|azure|gcp --name NAME --profile smoke
scripts/lab down --cloud aws|azure|gcp --name NAME --yes
```

Run `scripts/lab down` even after failed deploy, seed, benchmark, or report steps so cloud resources do not continue to accrue cost.

## Validation

The CI workflow keeps the epic surface intact by checking:

- YAML parsing for workflow, chart, and manifest files.
- `scripts/lab` shell syntax and dry-run coverage for seed, benchmark, and report commands.
- Synthea loader syntax, metadata generation, and HTTP import behavior.
- k6 profile syntax and required FHIR operation coverage.
- Result publisher syntax and output contract.
- Ansible playbook syntax.
- Terraform formatting and validation for AWS, Azure, and GCP.
- Rev2 baseline guardrails.
- Epic acceptance surface through `test/lab_epic_acceptance_test.rb`.

Helm rendering remains covered in CI because the workflow installs Helm before chart validation.
