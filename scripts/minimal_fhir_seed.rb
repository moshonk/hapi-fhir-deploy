#!/usr/bin/env ruby
# frozen_string_literal: true

require "fileutils"
require "json"
require "net/http"
require "optparse"
require "time"
require "uri"

class SeedError < StandardError; end

options = {
  batch_size: 100,
  timeout: 120
}

OptionParser.new do |opts|
  opts.banner = "Usage: scripts/minimal_fhir_seed.rb --patients N --seed S --run-id RUN_ID --metadata FILE --fhir-base-url URL"
  opts.on("--patients N", Integer, "Number of Patient resources to create.") { |value| options[:patients] = value }
  opts.on("--seed S", Integer, "Deterministic seed recorded in metadata.") { |value| options[:seed] = value }
  opts.on("--run-id RUN_ID", "Run identifier.") { |value| options[:run_id] = value }
  opts.on("--metadata FILE", "Dataset metadata JSON file to write.") { |value| options[:metadata] = value }
  opts.on("--fhir-base-url URL", "FHIR base URL that accepts transaction bundle POSTs.") { |value| options[:fhir_base_url] = value }
  opts.on("--batch-size N", Integer, "Patients per transaction bundle; default 100.") { |value| options[:batch_size] = value }
  opts.on("--timeout SECONDS", Integer, "HTTP open/read timeout in seconds; default 120.") { |value| options[:timeout] = value }
  opts.on("-h", "--help", "Show this help.") do
    puts opts
    exit
  end
end.parse!

begin

def require_option(options, key)
  value = options[key]
  return value unless value.nil? || value.to_s.empty?

  raise SeedError, "missing required option --#{key.to_s.tr("_", "-")}"
end

patients = require_option(options, :patients)
seed = require_option(options, :seed)
run_id = require_option(options, :run_id)
metadata_path = require_option(options, :metadata)
fhir_base_url = require_option(options, :fhir_base_url).to_s.sub(%r{/+\z}, "")
batch_size = require_option(options, :batch_size)
timeout = require_option(options, :timeout)

raise SeedError, "--patients must be greater than zero" unless patients.positive?
raise SeedError, "--seed must be non-negative" if seed.negative?
raise SeedError, "--batch-size must be greater than zero" unless batch_size.positive?
raise SeedError, "--timeout must be greater than zero" unless timeout.positive?

uri = URI(fhir_base_url)
raise SeedError, "FHIR base URL must be http or https: #{fhir_base_url}" unless %w[http https].include?(uri.scheme)

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

def response_entries(response_body)
  parsed = JSON.parse(response_body)
  return [] unless parsed.is_a?(Hash) && parsed["resourceType"] == "Bundle"

  Array(parsed["entry"])
rescue JSON::ParserError
  []
end

def patient_resource(index)
  id = format("bench-p%06d", index)
  birth_year = 1940 + (index % 70)
  {
    "resourceType" => "Patient",
    "id" => id,
    "identifier" => [
      {
        "system" => "urn:hapi-fhir-deploy:benchmark",
        "value" => id
      }
    ],
    "active" => true,
    "name" => [
      {
        "family" => format("Benchmark%06d", index),
        "given" => [format("Patient%06d", index)]
      }
    ],
    "gender" => index.even? ? "female" : "male",
    "birthDate" => format("%04d-%02d-%02d", birth_year, (index % 12) + 1, (index % 28) + 1)
  }
end

def encounter_resource(index)
  id = format("bench-e%06d", index)
  patient_id = format("bench-p%06d", index)
  date = format("2025-%02d-%02d", (index % 12) + 1, (index % 28) + 1)
  {
    "resourceType" => "Encounter",
    "id" => id,
    "status" => "finished",
    "class" => {
      "system" => "http://terminology.hl7.org/CodeSystem/v3-ActCode",
      "code" => "AMB"
    },
    "subject" => { "reference" => "Patient/#{patient_id}" },
    "period" => {
      "start" => "#{date}T09:00:00Z",
      "end" => "#{date}T09:15:00Z"
    }
  }
end

def condition_resource(index)
  id = format("bench-c%06d", index)
  patient_id = format("bench-p%06d", index)
  {
    "resourceType" => "Condition",
    "id" => id,
    "clinicalStatus" => {
      "coding" => [
        {
          "system" => "http://terminology.hl7.org/CodeSystem/condition-clinical",
          "code" => "active"
        }
      ]
    },
    "verificationStatus" => {
      "coding" => [
        {
          "system" => "http://terminology.hl7.org/CodeSystem/condition-ver-status",
          "code" => "confirmed"
        }
      ]
    },
    "code" => {
      "coding" => [
        {
          "system" => "http://snomed.info/sct",
          "code" => "38341003",
          "display" => "Hypertensive disorder, systemic arterial"
        }
      ]
    },
    "subject" => { "reference" => "Patient/#{patient_id}" }
  }
end

def observation_resource(index)
  id = format("bench-o%06d", index)
  patient_id = format("bench-p%06d", index)
  {
    "resourceType" => "Observation",
    "id" => id,
    "status" => "final",
    "code" => {
      "coding" => [
        {
          "system" => "http://loinc.org",
          "code" => "8867-4",
          "display" => "Heart rate"
        }
      ]
    },
    "subject" => { "reference" => "Patient/#{patient_id}" },
    "effectiveDateTime" => format("2025-%02d-%02dT09:05:00Z", (index % 12) + 1, (index % 28) + 1),
    "valueQuantity" => {
      "value" => 60 + (index % 50),
      "unit" => "beats/minute",
      "system" => "http://unitsofmeasure.org",
      "code" => "/min"
    }
  }
end

def bundle_for(range)
  entries = []
  range.each do |index|
    [
      patient_resource(index),
      encounter_resource(index),
      condition_resource(index),
      observation_resource(index)
    ].each do |resource|
      entries << {
        "resource" => resource,
        "request" => {
          "method" => "PUT",
          "url" => "#{resource["resourceType"]}/#{resource["id"]}"
        }
      }
    end
  end
  {
    "resourceType" => "Bundle",
    "type" => "transaction",
    "entry" => entries
  }
end

started_at = Time.now.utc
http_status_counts = Hash.new(0)
fhir_response_status_counts = Hash.new(0)
errors = []
imported_entry_count = 0
transaction_bundle_count = 0

(1..patients).each_slice(batch_size) do |slice|
  transaction_bundle_count += 1
  bundle = bundle_for(slice)
  response = post_bundle(uri, bundle, timeout)
  http_status_counts[response.code] += 1

  unless response.code.to_i >= 200 && response.code.to_i < 300
    errors << {
      "batch" => transaction_bundle_count,
      "http_status" => response.code,
      "message" => response.body.to_s[0, 500]
    }
    next
  end

  entries = response_entries(response.body)
  expected_entries = bundle.fetch("entry").length
  if entries.length < expected_entries
    errors << {
      "batch" => transaction_bundle_count,
      "http_status" => response.code,
      "message" => "partial transaction response: expected at least #{expected_entries} entries, got #{entries.length}"
    }
  end

  entries.each do |entry|
    status = entry.dig("response", "status").to_s
    fhir_response_status_counts[status] += 1
    imported_entry_count += 1 if status_success?(status)
  end

  puts "Imported #{slice.last}/#{patients} patients" if (transaction_bundle_count % 10).zero? || slice.last == patients
rescue StandardError => e
  errors << {
    "batch" => transaction_bundle_count,
    "message" => "#{e.class}: #{e.message}"
  }
end

completed_at = Time.now.utc
generated_entry_count = patients * 4
metadata = {
  "run_id" => run_id,
  "synthea" => {
    "patients" => patients,
    "seed" => seed,
    "input_dir" => nil,
    "generator" => "minimal_fhir_seed",
    "transaction_bundle_count" => transaction_bundle_count,
    "skipped_bundle_count" => 0,
    "generated_entry_count" => generated_entry_count,
    "resource_counts" => {
      "Condition" => patients,
      "Encounter" => patients,
      "Observation" => patients,
      "Patient" => patients
    },
    "bundle_files" => [],
    "skipped_bundle_files" => []
  },
  "import" => {
    "mode" => "transaction-load",
    "fhir_base_url" => fhir_base_url,
    "started_at_utc" => started_at.iso8601,
    "completed_at_utc" => completed_at.iso8601,
    "duration_seconds" => (completed_at - started_at).round(3),
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
  warn "Minimal FHIR seed failed with #{errors.length} error(s); see #{metadata_path}"
  exit 1
end

puts "Wrote minimal FHIR dataset metadata to #{metadata_path}"
puts "Imported #{imported_entry_count} resource entries into #{fhir_base_url}."
rescue SeedError => e
  warn "scripts/minimal_fhir_seed.rb: #{e.message}"
  exit 1
end
