# frozen_string_literal: true

require "minitest/autorun"
require "yaml"

class LabEpicAcceptanceTest < Minitest::Test
  ROOT_DIR = File.expand_path("..", __dir__)

  def test_lab_wrapper_exposes_full_epic_workflow
    lab = read("scripts/lab")
    help = `#{File.join(ROOT_DIR, "scripts/lab")} --help`

    %w[up deploy seed benchmark report down].each do |command|
      assert_includes help, "scripts/lab #{command}", "missing #{command} usage"
      assert_match(/#{Regexp.escape(command)}\)/, lab, "missing #{command} dispatch")
    end

    assert_includes help, "--cloud aws|azure|gcp"
    assert_includes help, "--profile smoke|baseline|load|stress"
    assert_includes help, "LAB_RESULTS_DIR"
    assert_includes help, "Use this promptly to control cloud cost"
  end

  def test_multi_cloud_terraform_modules_expose_ansible_consumable_outputs
    %w[aws azure gcp].each do |provider|
      root = "infra/terraform/#{provider}"
      assert_path_exists File.join(ROOT_DIR, root, "main.tf")
      assert_path_exists File.join(ROOT_DIR, root, "variables.tf")
      outputs = read("#{root}/outputs.tf")
      variables = read("#{root}/variables.tf")

      %w[
        cloud
        region
        kubeconfig
        database_endpoint
        database_password
        node_size
        cluster_node_count
        db_sku
        ansible_metadata
      ].each do |output|
        assert_match(/output "#{output}"/, outputs, "#{provider} missing #{output} output")
      end

      assert_match(/postgres_version/, variables)
      assert_match(/16/, variables)
      assert_match(/17/, variables)
      assert_match(/ttl_hours/, variables)
    end
  end

  def test_ansible_deployment_workflow_is_provider_neutral_after_kubeconfig
    playbook = YAML.safe_load(
      read("ansible/playbooks/lab.yml"),
      permitted_classes: [],
      permitted_symbols: [],
      aliases: false
    )
    imports = playbook.map { |entry| entry.fetch("import_playbook") }

    assert_equal(
      %w[
        00-install-addons.yml
        20-deploy-hapi-fhir.yml
        30-wait-readiness.yml
        40-collect-metadata.yml
      ],
      imports
    )

    deploy = read("ansible/playbooks/20-deploy-hapi-fhir.yml")
    assert_includes deploy, "hapi-fhir-postgres"
    assert_includes deploy, "helm"
    assert_includes deploy, "hapi-fhir-deploy"

    wait = read("ansible/playbooks/30-wait-readiness.yml")
    %w[hapi_deployment_name exporter_deployment_name keda metrics].each do |surface|
      assert_includes wait, surface
    end
  end

  def test_synthea_k6_and_result_artifacts_are_wired_together
    assert_path_exists File.join(ROOT_DIR, "benchmarks/synthea/synthea.properties")
    assert_path_exists File.join(ROOT_DIR, "scripts/synthea_loader.rb")
    assert_path_exists File.join(ROOT_DIR, "scripts/publish_results.rb")

    %w[smoke baseline load stress].each do |profile|
      assert_path_exists File.join(ROOT_DIR, "benchmarks/k6/#{profile}.js")
    end

    common = read("benchmarks/k6/lib/fhir_benchmark.js")
    %w[
      capability_statement
      patient_search
      patient_read
      observation_search
      encounter_search
      condition_search
      bulk_export
      fhir_no_pod_restarts
      fhir_hikari_connection_headroom
    ].each do |operation|
      assert_includes common, operation
    end

    publisher = read("scripts/publish_results.rb")
    %w[
      k6-summary.json
      k6-fhir-summary.json
      k6-raw.jsonl
      dataset-metadata.json
      benchmark-metadata.json
      environment.json
      summary.csv
      report.md
      prometheus-snapshots.json
    ].each do |artifact|
      assert_includes publisher, artifact
    end

    refute_includes publisher, "terraform-output.json"
  end

  def test_docs_cover_smoke_safety_interpretation_and_conformance_boundary
    epic = read("docs/benchmark-lab-epic.md")
    runbook = read("docs/benchmark-lab-runbook.md")

    %w[provision deploy seed benchmark report destroy].each do |stage|
      assert_match(/#{stage}/i, epic)
    end

    [
      "scripts/lab down",
      "Quick Smoke Benchmark",
      "Cloud Credentials",
      "Cost Controls",
      "Benchmark Methodology",
      "Synthea Usage",
      "Results And Interpretation",
      "Conformance Tools Versus Load Benchmarks",
      "Synthea",
      "HL7 FHIR Bulk Data Access",
      "Inferno",
      "Touchstone"
    ].each do |expected|
      assert_includes runbook, expected
    end
  end

  def test_local_secret_and_result_artifacts_remain_ignored
    gitignore = read(".gitignore")
    [
      "**/.terraform/",
      "*.tfvars",
      "*.tfvars.json",
      "*.kubeconfig",
      "ansible/artifacts/*",
      "results/"
    ].each do |pattern|
      assert_includes gitignore, pattern
    end

    refute_path_exists File.join(ROOT_DIR, "results"), "results/ must remain local and ignored"
  end

  private

  def read(path)
    File.read(File.join(ROOT_DIR, path))
  end
end
