#!/usr/bin/env ruby
# frozen_string_literal: true

require "csv"
require "fileutils"
require "json"
require "optparse"
require "time"
require "yaml"

class PublishError < StandardError; end

ROOT_DIR = File.expand_path("..", __dir__)

options = {
  results_root: File.join(ROOT_DIR, "results")
}

parser = OptionParser.new do |opts|
  opts.banner = "Usage: scripts/publish_results.rb --run-dir DIR --run-id RUN_ID [options]"

  opts.on("--run-dir DIR", "Ignored lab run directory containing raw artifacts.") { |value| options[:run_dir] = value }
  opts.on("--run-id RUN_ID", "Lab run identifier.") { |value| options[:run_id] = value }
  opts.on("--results-root DIR", "Results root; default results/.") { |value| options[:results_root] = value }
  opts.on("--cloud CLOUD", "Cloud/provider name.") { |value| options[:cloud] = value }
  opts.on("--profile PROFILE", "Benchmark profile.") { |value| options[:profile] = value }
  opts.on("--terraform-output FILE", "Terraform output JSON file.") { |value| options[:terraform_output] = value }
  opts.on("--deployment-metadata FILE", "Ansible deployment metadata JSON file.") { |value| options[:deployment_metadata] = value }
  opts.on("--created-at TIMESTAMP", "UTC timestamp for deterministic tests.") { |value| options[:created_at] = value }
  opts.on("-h", "--help", "Show this help.") do
    puts opts
    exit
  end
end

def require_option(options, key)
  value = options[key]
  return value unless value.nil? || value.to_s.empty?

  raise PublishError, "missing required option --#{key.to_s.tr("_", "-")}"
end

def read_json(path)
  return nil unless path && File.file?(path)

  JSON.parse(File.read(path))
rescue JSON::ParserError => e
  raise PublishError, "#{path}: invalid JSON: #{e.message}"
end

def read_yaml(path)
  YAML.safe_load(
    File.read(path),
    permitted_classes: [],
    permitted_symbols: [],
    aliases: false
  )
end

def output_value(terraform_outputs, key)
  value = terraform_outputs&.dig(key, "value")
  value.nil? ? nil : value
end

def image_pin(image)
  return nil unless image.is_a?(Hash)

  registry = image["registry"].to_s
  repository = image["repository"].to_s
  tag = image["tag"].to_s
  [registry, repository].reject(&:empty?).join("/") + (tag.empty? ? "" : ":#{tag}")
end

def hapi_values
  @hapi_values ||= read_yaml(File.join(ROOT_DIR, "charts/hapi-fhir-deploy/values.yaml"))
end

def chart_metadata
  @chart_metadata ||= read_yaml(File.join(ROOT_DIR, "charts/hapi-fhir-deploy/Chart.yaml"))
end

def hikari_pool_size(chart)
  extra_config = chart["extraConfig"]
  return nil unless extra_config.is_a?(String)

  parsed = YAML.safe_load(extra_config, permitted_classes: [], permitted_symbols: [], aliases: false)
  parsed.dig("spring", "datasource", "hikari", "maximumPoolSize")
rescue Psych::SyntaxError
  nil
end

def metric_value(hash, *keys)
  keys.reduce(hash) { |memo, key| memo.is_a?(Hash) ? memo[key] : nil }
end

# Generator-agnostic view of dataset-metadata.json, whether it came from a
# single-shard minimal_fhir_seed.rb/echis_seed.rb run or a merged multi-shard
# run (scripts/merge_seed_shards.rb). Detects the generator-specific top-level
# key ("synthea" or "echis") the same way merge_seed_shards.rb does, so a
# report doesn't silently show blank dataset fields for eCHIS tiers -- the
# prior "synthea"-only lookup never populated anything for eCHIS runs.
# households/individuals fall back to resource_counts's Group/Patient totals
# when a generator doesn't track them as a direct field (minimal_fhir_seed.rb,
# and merged multi-shard output, which sums resource_counts but doesn't carry
# a separate households/patients field of its own).
def dataset_section(dataset_metadata)
  return nil unless dataset_metadata.is_a?(Hash)

  key = (dataset_metadata.keys - %w[run_id import created_at_utc completed_at_utc]).first
  return nil unless key

  section = dataset_metadata[key] || {}
  resource_counts = section["resource_counts"] || {}
  {
    "generator" => section["generator"] || key,
    "seed" => section["seed"],
    "households" => section["households"] || resource_counts["Group"],
    "individuals" => section["patients"] || resource_counts["Patient"],
    "resource_counts" => resource_counts,
    "generated_entry_count" => section["generated_entry_count"],
    "shard_count" => section["shard_count"],
    "shard_indices_present" => section["shard_indices_present"]
  }
end

def multi_shard?(dataset, fhir_summary)
  (dataset && dataset["shard_count"].to_i > 1) || (fhir_summary && fhir_summary["shard_count"].to_i > 1)
end

def slug(value)
  candidate = value.to_s.downcase.gsub(/[^a-z0-9._-]+/, "-").gsub(/^-+|-+$/, "")
  candidate.empty? ? "unknown" : candidate
end

def copy_if_present(source, destination_dir, destination_name = nil)
  return unless source && File.file?(source)

  FileUtils.mkdir_p(destination_dir)
  FileUtils.cp(source, File.join(destination_dir, destination_name || File.basename(source)))
end

def write_json(path, data)
  FileUtils.mkdir_p(File.dirname(path))
  File.write(path, "#{JSON.pretty_generate(data)}\n")
end

def csv_rows(environment, fhir_summary)
  dataset = environment["dataset"]
  rows = []
  rows << ["run_id", environment.dig("benchmark", "run_id")]
  rows << ["cloud", environment.dig("cloud", "provider")]
  rows << ["region", environment.dig("cloud", "region")]
  rows << ["node_size", environment.dig("cloud", "node_size")]
  rows << ["db_sku", environment.dig("cloud", "db_sku")]
  rows << ["profile", environment.dig("benchmark", "profile")]
  rows << ["synthea_patients", environment.dig("synthea", "patients")]
  rows << ["synthea_seed", environment.dig("synthea", "seed")]
  rows << ["dataset_generator", dataset&.dig("generator")]
  rows << ["dataset_households", dataset&.dig("households")]
  rows << ["dataset_individuals", dataset&.dig("individuals")]
  rows << ["dataset_generated_entry_count", dataset&.dig("generated_entry_count")]
  rows << ["dataset_shard_count", dataset&.dig("shard_count")]
  rows << ["replicas", environment.dig("runtime", "replicas")]
  rows << ["hikari_pool", environment.dig("runtime", "hikari_pool")]
  rows << ["latency_p50_ms", metric_value(fhir_summary, "latency_ms", "p50")]
  rows << ["latency_p95_ms", metric_value(fhir_summary, "latency_ms", "p95")]
  rows << ["latency_p99_ms", metric_value(fhir_summary, "latency_ms", "p99")]
  rows << ["latency_source", fhir_summary&.dig("latency_source") || "k6"]
  rows << ["throughput_reqs_per_sec", fhir_summary&.dig("throughput_reqs_per_sec")]
  rows << ["http_failure_rate", fhir_summary&.dig("http_failure_rate")]
  rows << ["total_requests", fhir_summary&.dig("total_requests")]
  rows << ["failed_requests", fhir_summary&.dig("failed_requests")]
  rows << ["k6_shard_count", fhir_summary&.dig("shard_count")]
  (fhir_summary&.dig("operation_mix") || {}).sort.each do |operation, count|
    rows << ["operation_#{operation}", count]
  end
  rows
end

def write_csv(path, environment, fhir_summary)
  FileUtils.mkdir_p(File.dirname(path))
  CSV.open(path, "w") do |csv|
    csv << ["metric", "value"]
    csv_rows(environment, fhir_summary).each { |row| csv << row }
  end
end

def markdown_report(environment, fhir_summary, result_dir)
  operation_mix = fhir_summary&.dig("operation_mix") || {}
  gates = fhir_summary&.dig("gates") || {}
  dataset = environment["dataset"]
  sharded = multi_shard?(dataset, fhir_summary)
  latency_from_prometheus = fhir_summary&.dig("latency_source") == "prometheus"

  lines = []
  lines << "# HAPI FHIR Benchmark Report"
  lines << ""
  lines << "| Field | Value |"
  lines << "| --- | --- |"
  lines << "| Run ID | `#{environment.dig("benchmark", "run_id") || "unknown"}` |"
  lines << "| Profile | `#{environment.dig("benchmark", "profile") || "unknown"}` |"
  lines << "| Cloud | `#{environment.dig("cloud", "provider") || "unknown"}` |"
  lines << "| Region | `#{environment.dig("cloud", "region") || "unknown"}` |"
  lines << "| Node size | `#{environment.dig("cloud", "node_size") || "unknown"}` |"
  lines << "| DB SKU | `#{environment.dig("cloud", "db_sku") || "unknown"}` |"
  lines << "| Replicas | `#{environment.dig("runtime", "replicas") || "unknown"}` |"
  lines << "| Hikari pool | `#{environment.dig("runtime", "hikari_pool") || "unknown"}` |"
  lines << "| Synthea patients | `#{environment.dig("synthea", "patients") || "unknown"}` |"
  lines << "| Synthea seed | `#{environment.dig("synthea", "seed") || "unknown"}` |"
  lines << "| Dataset generator | `#{dataset&.dig("generator") || "unknown"}` |"
  lines << "| Dataset households | `#{dataset&.dig("households") || "unknown"}` |"
  lines << "| Dataset individuals | `#{dataset&.dig("individuals") || "unknown"}` |"
  lines << "| Dataset shard count | `#{dataset&.dig("shard_count") || 1}` |"
  lines << ""
  lines << "## Latency And Throughput"
  lines << ""
  lines << "| Metric | Value |"
  lines << "| --- | --- |"
  if latency_from_prometheus
    lines << "| p50 latency ms | see Prometheus (multi-shard run) |"
    lines << "| p95 latency ms | see Prometheus (multi-shard run) |"
    lines << "| p99 latency ms | see Prometheus (multi-shard run) |"
  else
    lines << "| p50 latency ms | `#{metric_value(fhir_summary, "latency_ms", "p50") || "unknown"}` |"
    lines << "| p95 latency ms | `#{metric_value(fhir_summary, "latency_ms", "p95") || "unknown"}` |"
    lines << "| p99 latency ms | `#{metric_value(fhir_summary, "latency_ms", "p99") || "unknown"}` |"
  end
  lines << "| Throughput req/s | `#{fhir_summary&.dig("throughput_reqs_per_sec") || "unknown"}` |"
  lines << "| HTTP failure rate | `#{fhir_summary&.dig("http_failure_rate") || "unknown"}` |"
  lines << "| Total requests | `#{fhir_summary&.dig("total_requests") || "unknown"}` |"
  lines << "| Failed requests | `#{fhir_summary&.dig("failed_requests") || "unknown"}` |"
  lines << ""
  if sharded
    lines << "## Data Source"
    lines << ""
    lines << "This run combined #{fhir_summary&.dig("shard_count") || dataset&.dig("shard_count")} shards " \
             "(`scripts/merge_seed_shards.rb`/`scripts/merge_k6_shards.rb`). Dataset totals, throughput, " \
             "failure rate, and operation mix below are summed/recomputed from every shard's own output. " \
             "Latency percentiles are **not** derived from shard data -- per `research.md` Decision 4, " \
             "combining per-shard percentiles is not mathematically valid, so they must be read from " \
             "Prometheus/Actuator histograms for the run window instead (see `docs/autoscaling.md` for the " \
             "scrape configuration)."
    lines << ""
  end
  lines << "## FHIR Operation Mix"
  lines << ""
  lines << "| Operation | Count |"
  lines << "| --- | ---: |"
  if operation_mix.empty?
    lines << "| unavailable | 0 |"
  else
    operation_mix.sort.each { |operation, count| lines << "| `#{operation}` | #{count} |" }
  end
  lines << ""
  lines << "## Baseline Gates"
  lines << ""
  lines << "| Gate | Rate |"
  lines << "| --- | ---: |"
  if gates.empty?
    lines << "| unavailable | unknown |"
  else
    gates.sort.each { |gate, rate| lines << "| `#{gate}` | #{rate.nil? ? "unknown" : rate} |" }
  end
  lines << ""
  lines << "## Chart And Image Pins"
  lines << ""
  lines << "- Wrapper chart: `#{environment.dig("chart", "wrapper_chart_version") || "unknown"}`"
  lines << "- HAPI chart: `#{environment.dig("chart", "hapi_chart_version") || "unknown"}`"
  lines << "- HAPI image: `#{environment.dig("chart", "hapi_image") || "unknown"}`"
  lines << "- Exporter chart: `#{environment.dig("chart", "exporter_chart_version") || "unknown"}`"
  lines << "- Exporter image: `#{environment.dig("chart", "exporter_image") || "unknown"}`"
  lines << ""
  lines << "## Raw Artifacts"
  lines << ""
  Dir[File.join(result_dir, "raw", "*")].sort.each do |path|
    lines << "- `raw/#{File.basename(path)}`"
  end
  lines << ""
  lines.join("\n")
end

def html_report(markdown)
  escaped = markdown
    .gsub("&", "&amp;")
    .gsub("<", "&lt;")
    .gsub(">", "&gt;")
  <<~HTML
    <!doctype html>
    <html lang="en">
    <head>
      <meta charset="utf-8">
      <title>HAPI FHIR Benchmark Report</title>
      <style>
        body { font-family: system-ui, sans-serif; margin: 2rem; line-height: 1.5; }
        pre { white-space: pre-wrap; background: #f6f8fa; padding: 1rem; border: 1px solid #d0d7de; }
      </style>
    </head>
    <body>
      <pre>#{escaped}</pre>
    </body>
    </html>
  HTML
end

begin
  parser.parse!

  run_dir = require_option(options, :run_dir)
  run_id = require_option(options, :run_id)
  raise PublishError, "run directory not found: #{run_dir}" unless File.directory?(run_dir)

  dataset_metadata = read_json(File.join(run_dir, "dataset-metadata.json"))
  benchmark_metadata = read_json(File.join(run_dir, "benchmark-metadata.json"))
  k6_summary = read_json(File.join(run_dir, "k6-summary.json"))
  fhir_summary = read_json(File.join(run_dir, "k6-fhir-summary.json"))
  terraform_outputs = read_json(options[:terraform_output])
  deployment_metadata = read_json(options[:deployment_metadata])

  values = hapi_values
  chart = chart_metadata
  hapi_chart = values.fetch("hapi-fhir-jpaserver")
  exporter_chart = values.fetch("fhir-server-exporter")
  dependencies = chart.fetch("dependencies", [])
  hapi_dependency = dependencies.find { |dependency| dependency["name"] == "hapi-fhir-jpaserver" } || {}
  exporter_dependency = dependencies.find { |dependency| dependency["name"] == "fhir-server-exporter" } || {}

  cloud = options[:cloud] || benchmark_metadata&.dig("cloud") || output_value(terraform_outputs, "cloud")
  profile = options[:profile] || benchmark_metadata&.dig("profile") || fhir_summary&.dig("profile")
  created_at = Time.parse(options[:created_at] || benchmark_metadata&.dig("created_at_utc") || Time.now.utc.iso8601).utc
  result_dir_name = [
    created_at.strftime("%Y%m%d-%H%M%S"),
    slug(cloud),
    slug(profile)
  ].join("-")
  result_dir = File.join(options[:results_root], result_dir_name)
  raise PublishError, "result directory already exists: #{result_dir}" if File.exist?(result_dir)

  raw_dir = File.join(result_dir, "raw")
  FileUtils.mkdir_p(raw_dir)

  environment = {
    "run_id" => run_id,
    "generated_at_utc" => created_at.iso8601,
    "cloud" => {
      "provider" => cloud,
      "region" => output_value(terraform_outputs, "region") || ENV["LAB_REGION"],
      "node_size" => output_value(terraform_outputs, "node_size") || ENV["LAB_NODE_SIZE"],
      "db_sku" => output_value(terraform_outputs, "db_sku") || ENV["LAB_DB_SKU"],
      "cluster_node_count" => output_value(terraform_outputs, "cluster_node_count")
    },
    "runtime" => {
      "replicas" => deployment_metadata&.dig("hapi_deployment", "spec", "replicas") || hapi_chart["replicaCount"],
      "hikari_pool" => hikari_pool_size(hapi_chart)
    },
    "chart" => {
      "wrapper_chart_version" => chart["version"],
      "app_version" => chart["appVersion"],
      "hapi_chart_version" => hapi_dependency["version"],
      "hapi_image" => image_pin(hapi_chart["image"]),
      "exporter_chart_version" => exporter_dependency["version"],
      "exporter_image" => image_pin(exporter_chart["image"])
    },
    "synthea" => {
      "patients" => dataset_metadata&.dig("synthea", "patients"),
      "seed" => dataset_metadata&.dig("synthea", "seed")
    },
    "dataset" => dataset_section(dataset_metadata),
    "benchmark" => {
      "run_id" => run_id,
      "profile" => profile,
      "fhir_base_url" => benchmark_metadata&.dig("fhir_base_url"),
      "bulk_export_enabled" => benchmark_metadata&.dig("bulk_export_enabled")
    }
  }

  copy_if_present(File.join(run_dir, "k6-summary.json"), raw_dir)
  copy_if_present(File.join(run_dir, "k6-fhir-summary.json"), raw_dir)
  copy_if_present(File.join(run_dir, "k6-raw.jsonl"), raw_dir)
  copy_if_present(File.join(run_dir, "dataset-metadata.json"), raw_dir)
  copy_if_present(File.join(run_dir, "benchmark-metadata.json"), raw_dir)
  copy_if_present(options[:deployment_metadata], raw_dir, "deployment-metadata.json")

  prometheus_snapshots = {
    "available" => false,
    "source" => "not captured",
    "snapshots" => []
  }
  %w[prometheus-before.json prometheus-after.json prometheus-snapshots.json].each do |name|
    path = File.join(run_dir, name)
    next unless File.file?(path)

    copy_if_present(path, raw_dir)
    prometheus_snapshots["available"] = true
    prometheus_snapshots["source"] = "raw/#{name}"
    prometheus_snapshots["snapshots"] << read_json(path)
  end
  if !prometheus_snapshots["available"] && fhir_summary&.dig("gates")
    prometheus_snapshots["source"] = "k6-fhir-summary.json gate rates"
    prometheus_snapshots["gates"] = fhir_summary["gates"]
  end

  write_json(File.join(result_dir, "environment.json"), environment)
  write_json(File.join(result_dir, "prometheus-snapshots.json"), prometheus_snapshots)
  write_csv(File.join(result_dir, "summary.csv"), environment, fhir_summary)
  markdown = markdown_report(environment, fhir_summary, result_dir)
  File.write(File.join(result_dir, "report.md"), markdown)
  File.write(File.join(result_dir, "index.html"), html_report(markdown))

  puts result_dir
rescue PublishError => e
  warn "scripts/publish_results.rb: #{e.message}"
  exit 1
rescue StandardError => e
  warn "scripts/publish_results.rb: #{e.class}: #{e.message}"
  exit 1
end
