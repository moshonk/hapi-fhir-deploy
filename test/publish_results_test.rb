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
      assert_includes environment.dig("chart", "hapi_image"), "hapiproject/hapi:v8.10.0-2@sha256:"

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

  private

  def write_json(path, data)
    FileUtils.mkdir_p(File.dirname(path))
    File.write(path, "#{JSON.pretty_generate(data)}\n")
  end
end
