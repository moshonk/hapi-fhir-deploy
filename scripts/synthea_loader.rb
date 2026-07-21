#!/usr/bin/env ruby
# frozen_string_literal: true

require "fileutils"
require "find"
require "json"
require "net/http"
require "optparse"
require "time"
require "uri"

class LoaderError < StandardError; end

options = {
  timeout: 120,
  metadata_only: false
}

parser = OptionParser.new do |opts|
  opts.banner = "Usage: scripts/synthea_loader.rb --input DIR --metadata FILE --patients N --seed S --run-id RUN_ID [--fhir-base-url URL]"

  opts.on("--input DIR", "Directory containing Synthea FHIR JSON transaction bundles.") { |value| options[:input] = value }
  opts.on("--metadata FILE", "Dataset metadata JSON file to write.") { |value| options[:metadata] = value }
  opts.on("--patients N", Integer, "Population size used for Synthea generation.") { |value| options[:patients] = value }
  opts.on("--seed S", Integer, "Synthea seed used for deterministic generation.") { |value| options[:seed] = value }
  opts.on("--run-id RUN_ID", "Run identifier.") { |value| options[:run_id] = value }
  opts.on("--fhir-base-url URL", "FHIR base URL that accepts transaction bundle POSTs.") { |value| options[:fhir_base_url] = value }
  opts.on("--timeout SECONDS", Integer, "HTTP open/read timeout in seconds; default 120.") { |value| options[:timeout] = value }
  opts.on("--metadata-only", "Only scan bundles and write generated dataset metadata.") { options[:metadata_only] = true }
  opts.on("-h", "--help", "Show this help.") do
    puts opts
    exit
  end
end

begin
parser.parse!

def require_option(options, key)
  value = options[key]
  return value unless value.nil? || value.to_s.empty?

  raise LoaderError, "missing required option --#{key.to_s.tr("_", "-")}"
end

input_dir = require_option(options, :input)
metadata_path = require_option(options, :metadata)
patients = require_option(options, :patients)
seed = require_option(options, :seed)
run_id = require_option(options, :run_id)

unless options[:metadata_only]
  require_option(options, :fhir_base_url)
end

raise LoaderError, "input directory not found: #{input_dir}" unless File.directory?(input_dir)
raise LoaderError, "--patients must be greater than zero" unless patients.positive?
raise LoaderError, "--seed must be non-negative" if seed.negative?
raise LoaderError, "--timeout must be greater than zero" unless options[:timeout].positive?

def transaction_bundle_files(input_dir)
  Find.find(input_dir).select { |path| File.file?(path) && File.extname(path) == ".json" }.sort
end

def parse_json_file(path)
  JSON.parse(File.read(path))
rescue JSON::ParserError => e
  raise LoaderError, "#{path}: invalid JSON: #{e.message}"
end

def resource_counts_for(bundle)
  counts = Hash.new(0)
  Array(bundle["entry"]).each do |entry|
    resource_type = entry.dig("resource", "resourceType")
    counts[resource_type] += 1 if resource_type
  end
  counts
end

def merge_counts(target, source)
  source.each { |key, value| target[key] += value }
end

def status_success?(status)
  code = status.to_s.split(/\s+/, 2).first.to_i
  code >= 200 && code < 400
end

def post_bundle(uri, bundle, timeout)
  http = Net::HTTP.new(uri.host, uri.port)
  http.use_ssl = uri.scheme == "https"
  http.open_timeout = timeout
  http.read_timeout = timeout

  request = Net::HTTP::Post.new(uri.request_uri.empty? ? "/" : uri.request_uri)
  request["Accept"] = "application/fhir+json"
  request["Content-Type"] = "application/fhir+json"
  request.body = JSON.generate(bundle)

  http.request(request)
end

def response_bundle_entries(response_body)
  parsed = JSON.parse(response_body)
  return [] unless parsed.is_a?(Hash) && parsed["resourceType"] == "Bundle"

  Array(parsed["entry"])
rescue JSON::ParserError
  []
end

started_at = Time.now.utc
errors = []
bundles = []
generated_counts = Hash.new(0)
generated_entry_count = 0

transaction_bundle_files(input_dir).each do |path|
  json = parse_json_file(path)
  next unless json["resourceType"] == "Bundle"

  if json["type"] != "transaction"
    errors << {
      "file" => path,
      "message" => "expected Bundle.type transaction, got #{json["type"].inspect}"
    }
    next
  end

  counts = resource_counts_for(json)
  merge_counts(generated_counts, counts)
  entry_count = Array(json["entry"]).length
  generated_entry_count += entry_count
  bundles << {
    "path" => path,
    "entry_count" => entry_count,
    "resource_counts" => counts.sort.to_h
  }
end

errors << { "message" => "no FHIR transaction bundle JSON files found under #{input_dir}" } if bundles.empty?

import_started_at = Time.now.utc
http_status_counts = Hash.new(0)
fhir_response_status_counts = Hash.new(0)
imported_entry_count = 0
fhir_base_url = options[:fhir_base_url].to_s.sub(%r{/+\z}, "")

if errors.empty? && !options[:metadata_only]
  uri = URI(fhir_base_url)
  raise LoaderError, "FHIR base URL must be http or https: #{fhir_base_url}" unless %w[http https].include?(uri.scheme)

  bundles.each do |bundle_info|
    bundle = parse_json_file(bundle_info["path"])
    response = post_bundle(uri, bundle, options[:timeout])
    http_status_counts[response.code] += 1

    unless response.code.to_i >= 200 && response.code.to_i < 300
      errors << {
        "file" => bundle_info["path"],
        "http_status" => response.code,
        "message" => response.body.to_s[0, 500]
      }
      next
    end

    response_entries = response_bundle_entries(response.body)
    if response_entries.length < bundle_info["entry_count"]
      errors << {
        "file" => bundle_info["path"],
        "http_status" => response.code,
        "message" => "partial transaction response: expected at least #{bundle_info["entry_count"]} entries, got #{response_entries.length}"
      }
    end

    response_entries.each do |entry|
      status = entry.dig("response", "status").to_s
      fhir_response_status_counts[status] += 1
      next if status_success?(status)

      errors << {
        "file" => bundle_info["path"],
        "http_status" => response.code,
        "fhir_status" => status,
        "message" => entry.dig("response", "outcome", "issue", 0, "diagnostics").to_s
      }
    end

    imported_entry_count += response_entries.count { |entry| status_success?(entry.dig("response", "status")) }
  rescue StandardError => e
    errors << {
      "file" => bundle_info["path"],
      "message" => "#{e.class}: #{e.message}"
    }
  end
end

completed_at = Time.now.utc
metadata = {
  "run_id" => run_id,
  "synthea" => {
    "patients" => patients,
    "seed" => seed,
    "input_dir" => input_dir,
    "transaction_bundle_count" => bundles.length,
    "generated_entry_count" => generated_entry_count,
    "resource_counts" => generated_counts.sort.to_h,
    "bundle_files" => bundles
  },
  "import" => {
    "mode" => options[:metadata_only] ? "metadata-only" : "transaction-load",
    "fhir_base_url" => options[:metadata_only] ? nil : fhir_base_url,
    "started_at_utc" => import_started_at.iso8601,
    "completed_at_utc" => completed_at.iso8601,
    "duration_seconds" => (completed_at - import_started_at).round(3),
    "http_status_counts" => http_status_counts.sort.to_h,
    "fhir_response_status_counts" => fhir_response_status_counts.sort.to_h,
    "submitted_entry_count" => generated_entry_count,
    "imported_entry_count" => imported_entry_count,
    "error_count" => errors.length,
    "errors" => errors
  },
  "created_at_utc" => started_at.iso8601,
  "completed_at_utc" => completed_at.iso8601
}

FileUtils.mkdir_p(File.dirname(metadata_path))
File.write(metadata_path, "#{JSON.pretty_generate(metadata)}\n")

unless errors.empty?
  warn "FHIR seed load failed with #{errors.length} error(s); see #{metadata_path}"
  exit 1
end

puts "Wrote Synthea dataset metadata to #{metadata_path}"
puts "Scanned #{bundles.length} transaction bundle(s), #{generated_entry_count} generated resource entr#{generated_entry_count == 1 ? "y" : "ies"}."
if options[:metadata_only]
  puts "Metadata-only mode; no bundles were imported."
else
  puts "Imported #{imported_entry_count} resource entr#{imported_entry_count == 1 ? "y" : "ies"} into #{fhir_base_url}."
end
rescue LoaderError => e
  warn "scripts/synthea_loader.rb: #{e.message}"
  exit 1
end
