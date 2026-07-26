# frozen_string_literal: true

require "json"
require "fileutils"
require "minitest/autorun"
require "open3"
require "rbconfig"
require "tmpdir"

class PublishResultsTest < Minitest::Test
  ROOT_DIR = File.expand_path("..", __dir__)
  PUBLISHER = File.join(ROOT_DIR, "scripts", "publish_results.rb")

  def test_publishes_complete_result_directory_without_copying_terraform_outputs
    Dir.mktmpdir do |tmp|
      run_dir = File.join(tmp, "runs", "smoke-aws")
      results_root = File.join(tmp, "results")
      FileUtils.mkdir_p(run_dir)

      write_json(
        File.join(run_dir, "dataset-metadata.json"),
        "synthea" => {
          "patients" => 100,
          "seed" => 12_345,
          "resource_counts" => {
            "Patient" => 100,
            "Observation" => 250
          }
        },
        "import" => {
          "duration_seconds" => 5.5,
          "error_count" => 0
        }
      )
      write_json(
        File.join(run_dir, "benchmark-metadata.json"),
        "run_id" => "smoke-aws",
        "profile" => "smoke",
        "fhir_base_url" => "https://example.invalid/fhir",
        "bulk_export_enabled" => false,
        "created_at_utc" => "2026-07-21T01:02:03Z"
      )
      write_json(
        File.join(run_dir, "k6-summary.json"),
        "metrics" => {
          "http_req_duration" => {
            "values" => {
              "p(95)" => 120.0
            }
          }
        }
      )
      write_json(
        File.join(run_dir, "k6-fhir-summary.json"),
        "profile" => "smoke",
        "latency_ms" => {
          "p50" => 40.0,
          "p95" => 120.0,
          "p99" => 180.0
        },
        "throughput_reqs_per_sec" => 31.4,
        "http_failure_rate" => 0.0,
        "operation_mix" => {
          "capability_statement" => 1,
          "patient_search" => 20
        },
        "gates" => {
          "http_error_rate" => 0.0
        }
      )
      File.write(File.join(run_dir, "k6-raw.jsonl"), %({"type":"Point"}\n))
      write_json(
        File.join(run_dir, "prometheus-after.json"),
        "hikari_active" => 2
      )

      terraform_output = File.join(tmp, "terraform-output.json")
      write_json(
        terraform_output,
        "cloud" => { "value" => "aws" },
        "region" => { "value" => "us-east-1" },
        "node_size" => { "value" => "m6i.large" },
        "cluster_node_count" => { "value" => 3 },
        "db_sku" => { "value" => "db.m6i.large" },
        "database_password" => {
          "sensitive" => true,
          "value" => "do-not-copy"
        }
      )

      deployment_metadata = File.join(tmp, "deployment-metadata.json")
      write_json(
        deployment_metadata,
        "hapi_deployment" => {
          "spec" => {
            "replicas" => 2
          }
        }
      )

      stdout, stderr, status = Open3.capture3(
        RbConfig.ruby,
        PUBLISHER,
        "--run-dir", run_dir,
        "--run-id", "smoke-aws",
        "--results-root", results_root,
        "--cloud", "aws",
        "--profile", "smoke",
        "--terraform-output", terraform_output,
        "--deployment-metadata", deployment_metadata,
        "--created-at", "2026-07-21T01:02:03Z"
      )

      assert status.success?, "#{stdout}\n#{stderr}"
      result_dir = File.join(results_root, "20260721-010203-aws-smoke")
      assert_equal "#{result_dir}\n", stdout
      assert_path_exists File.join(result_dir, "environment.json")
      assert_path_exists File.join(result_dir, "summary.csv")
      assert_path_exists File.join(result_dir, "report.md")
      assert_path_exists File.join(result_dir, "index.html")
      assert_path_exists File.join(result_dir, "prometheus-snapshots.json")
      assert_path_exists File.join(result_dir, "raw", "k6-raw.jsonl")
      refute_path_exists File.join(result_dir, "raw", "terraform-output.json")

      environment = JSON.parse(File.read(File.join(result_dir, "environment.json")))
      assert_equal "aws", environment.dig("cloud", "provider")
      assert_equal "us-east-1", environment.dig("cloud", "region")
      assert_equal "m6i.large", environment.dig("cloud", "node_size")
      assert_equal "db.m6i.large", environment.dig("cloud", "db_sku")
      assert_equal 2, environment.dig("runtime", "replicas")
      assert_equal 10, environment.dig("runtime", "hikari_pool")
      assert_equal 100, environment.dig("synthea", "patients")
      assert_equal 12_345, environment.dig("synthea", "seed")
      assert_equal "smoke", environment.dig("benchmark", "profile")
      assert_match(%r{\Adocker\.io/hapiproject/hapi:[^@]+@sha256:[0-9a-f]{64}\z}, environment.dig("chart", "hapi_image"))

      report = File.read(File.join(result_dir, "report.md"))
      assert_includes report, "# HAPI FHIR Benchmark Report"
      assert_includes report, "raw/k6-summary.json"
      assert_includes report, "raw/prometheus-after.json"

      csv = File.read(File.join(result_dir, "summary.csv"))
      assert_includes csv, "latency_p95_ms,120.0"
      assert_includes csv, "operation_patient_search,20"

      snapshots = JSON.parse(File.read(File.join(result_dir, "prometheus-snapshots.json")))
      assert_equal true, snapshots.fetch("available")
      assert_equal "raw/prometheus-after.json", snapshots.fetch("source")
    end
  end

  def test_publishes_merged_multi_shard_echis_result_with_prometheus_latency_note
    Dir.mktmpdir do |tmp|
      run_dir = File.join(tmp, "runs", "load-echis-merged")
      results_root = File.join(tmp, "results")
      FileUtils.mkdir_p(run_dir)

      write_json(
        File.join(run_dir, "dataset-metadata.json"),
        "echis" => {
          "generator" => "echis_seed",
          "shard_count" => 3,
          "shard_indices_present" => [0, 1, 2],
          "generated_entry_count" => 5_839_996,
          "resource_counts" => {
            "Group" => 333_333,
            "Patient" => 999_999,
            "RelatedPerson" => 666_666
          }
        },
        "import" => {
          "error_count" => 0
        }
      )
      write_json(
        File.join(run_dir, "benchmark-metadata.json"),
        "run_id" => "load-echis-merged",
        "profile" => "load",
        "created_at_utc" => "2026-07-26T01:02:03Z"
      )
      write_json(
        File.join(run_dir, "k6-fhir-summary.json"),
        "profile" => "load",
        "latency_source" => "prometheus",
        "throughput_reqs_per_sec" => 9.86,
        "http_failure_rate" => 0.005,
        "total_requests" => 2970,
        "failed_requests" => 15,
        "duration_seconds" => 301.2,
        "operation_mix" => {
          "household_sync_write" => 1490,
          "worklist_read" => 900
        },
        "shard_count" => 3,
        "shard_indices_present" => [0, 1, 2]
      )

      stdout, stderr, status = Open3.capture3(
        RbConfig.ruby,
        PUBLISHER,
        "--run-dir", run_dir,
        "--run-id", "load-echis-merged",
        "--results-root", results_root,
        "--profile", "load",
        "--created-at", "2026-07-26T01:02:03Z"
      )

      assert status.success?, "#{stdout}\n#{stderr}"
      result_dir = File.join(results_root, "20260726-010203-unknown-load")

      environment = JSON.parse(File.read(File.join(result_dir, "environment.json")))
      assert_equal "echis_seed", environment.dig("dataset", "generator")
      assert_equal 333_333, environment.dig("dataset", "households")
      assert_equal 999_999, environment.dig("dataset", "individuals"), "individuals should fall back to resource_counts.Patient when no direct patients field is present"
      assert_equal 3, environment.dig("dataset", "shard_count")

      report = File.read(File.join(result_dir, "report.md"))
      assert_includes report, "see Prometheus (multi-shard run)"
      assert_includes report, "## Data Source"
      assert_includes report, "combined 3 shards"
      refute_includes report, "p95 latency ms | `unknown`", "a merged run should point at Prometheus, not just say latency is unknown"

      csv = File.read(File.join(result_dir, "summary.csv"))
      assert_includes csv, "dataset_generator,echis_seed"
      assert_includes csv, "dataset_shard_count,3"
      assert_includes csv, "total_requests,2970"
      assert_includes csv, "failed_requests,15"
    end
  end

  def test_environment_json_has_the_same_dataset_field_set_across_generators_and_shard_counts
    Dir.mktmpdir do |tmp|
      results_root = File.join(tmp, "results")

      single_shard_run_dir = File.join(tmp, "runs", "single")
      FileUtils.mkdir_p(single_shard_run_dir)
      write_json(
        File.join(single_shard_run_dir, "dataset-metadata.json"),
        "synthea" => { "patients" => 100_000, "seed" => 1, "resource_counts" => { "Patient" => 100_000 } },
        "import" => {}
      )
      write_json(
        File.join(single_shard_run_dir, "benchmark-metadata.json"),
        "run_id" => "single", "profile" => "load", "created_at_utc" => "2026-07-26T01:02:03Z"
      )
      write_json(File.join(single_shard_run_dir, "k6-fhir-summary.json"), "profile" => "load")

      merged_run_dir = File.join(tmp, "runs", "merged")
      FileUtils.mkdir_p(merged_run_dir)
      write_json(
        File.join(merged_run_dir, "dataset-metadata.json"),
        "echis" => { "generator" => "echis_seed", "shard_count" => 3, "resource_counts" => { "Group" => 10, "Patient" => 30 } },
        "import" => {}
      )
      write_json(
        File.join(merged_run_dir, "benchmark-metadata.json"),
        "run_id" => "merged", "profile" => "load", "created_at_utc" => "2026-07-26T04:05:06Z"
      )
      write_json(File.join(merged_run_dir, "k6-fhir-summary.json"), "profile" => "load", "latency_source" => "prometheus", "shard_count" => 3)

      _, stderr_a, status_a = Open3.capture3(
        RbConfig.ruby, PUBLISHER,
        "--run-dir", single_shard_run_dir, "--run-id", "single", "--results-root", results_root,
        "--profile", "load", "--created-at", "2026-07-26T01:02:03Z"
      )
      assert status_a.success?, stderr_a

      _, stderr_b, status_b = Open3.capture3(
        RbConfig.ruby, PUBLISHER,
        "--run-dir", merged_run_dir, "--run-id", "merged", "--results-root", results_root,
        "--profile", "load", "--created-at", "2026-07-26T04:05:06Z"
      )
      assert status_b.success?, stderr_b

      env_a = JSON.parse(File.read(File.join(results_root, "20260726-010203-unknown-load", "environment.json")))
      env_b = JSON.parse(File.read(File.join(results_root, "20260726-040506-unknown-load", "environment.json")))

      assert_equal env_a.keys.sort, env_b.keys.sort, "top-level environment.json fields must be comparable across generators/shard counts"
      assert_equal env_a["dataset"].keys.sort, env_b["dataset"].keys.sort, "dataset block fields must be comparable across generators/shard counts"
    end
  end

  def test_fails_when_result_directory_already_exists
    Dir.mktmpdir do |tmp|
      run_dir = File.join(tmp, "runs", "smoke-aws")
      results_root = File.join(tmp, "results")
      existing_result_dir = File.join(results_root, "20260721-010203-aws-smoke")
      FileUtils.mkdir_p(run_dir)
      FileUtils.mkdir_p(existing_result_dir)
      write_json(
        File.join(run_dir, "benchmark-metadata.json"),
        "run_id" => "smoke-aws",
        "profile" => "smoke",
        "created_at_utc" => "2026-07-21T01:02:03Z"
      )

      stdout, stderr, status = Open3.capture3(
        RbConfig.ruby,
        PUBLISHER,
        "--run-dir", run_dir,
        "--run-id", "smoke-aws",
        "--results-root", results_root,
        "--cloud", "aws",
        "--profile", "smoke"
      )

      refute status.success?, stdout
      assert_includes stderr, "result directory already exists: #{existing_result_dir}"
    end
  end

  private

  def write_json(path, data)
    FileUtils.mkdir_p(File.dirname(path))
    File.write(path, "#{JSON.pretty_generate(data)}\n")
  end
end
