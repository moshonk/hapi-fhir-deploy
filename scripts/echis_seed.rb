#!/usr/bin/env ruby
# frozen_string_literal: true

require "fileutils"
require "json"
require "net/http"
require "optparse"
require "set"
require "time"
require "uri"

class SeedError < StandardError; end

options = {
  individuals_per_household: 3,
  batch_size: 100,
  timeout: 120,
  shard_index: 0,
  shard_count: 1,
  metadata_only: false
}

OptionParser.new do |opts|
  opts.banner = "Usage: scripts/echis_seed.rb --households N --seed S --run-id RUN_ID --metadata FILE --fhir-base-url URL"
  opts.on("--households N", Integer, "Number of households to create (or this shard's slice of a larger target).") { |v| options[:households] = v }
  opts.on("--individuals-per-household N", Integer, "Average individuals per household; default 3.") { |v| options[:individuals_per_household] = v }
  opts.on("--seed S", Integer, "Deterministic seed recorded in metadata.") { |v| options[:seed] = v }
  opts.on("--run-id RUN_ID", "Run identifier.") { |v| options[:run_id] = v }
  opts.on("--metadata FILE", "Dataset metadata JSON file to write.") { |v| options[:metadata] = v }
  opts.on("--fhir-base-url URL", "FHIR base URL that accepts transaction bundle POSTs. Required unless --metadata-only.") { |v| options[:fhir_base_url] = v }
  opts.on("--batch-size N", Integer, "Households per transaction bundle; default 100.") { |v| options[:batch_size] = v }
  opts.on("--timeout SECONDS", Integer, "HTTP open/read timeout in seconds; default 120.") { |v| options[:timeout] = v }
  opts.on("--shard-index N", Integer, "This invocation's shard number (0-based); default 0.") { |v| options[:shard_index] = v }
  opts.on("--shard-count N", Integer, "Total number of shards; default 1.") { |v| options[:shard_count] = v }
  opts.on("--metadata-only", "Compute and record dataset metadata without making HTTP calls.") { options[:metadata_only] = true }
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

households = require_option(options, :households)
individuals_per_household = require_option(options, :individuals_per_household)
seed = require_option(options, :seed)
run_id = require_option(options, :run_id)
metadata_path = require_option(options, :metadata)
batch_size = require_option(options, :batch_size)
timeout = require_option(options, :timeout)
shard_index = require_option(options, :shard_index)
shard_count = require_option(options, :shard_count)
metadata_only = options[:metadata_only]

raise SeedError, "--households must be greater than zero" unless households.positive?
raise SeedError, "--individuals-per-household must be greater than zero" unless individuals_per_household.positive?
raise SeedError, "--seed must be non-negative" if seed.negative?
raise SeedError, "--batch-size must be greater than zero" unless batch_size.positive?
raise SeedError, "--timeout must be greater than zero" unless timeout.positive?
raise SeedError, "--shard-count must be greater than zero" unless shard_count.positive?
raise SeedError, "--shard-index must be non-negative and less than --shard-count" unless shard_index >= 0 && shard_index < shard_count

fhir_base_url = options[:fhir_base_url].to_s.sub(%r{/+\z}, "")
uri = nil
unless metadata_only
  raise SeedError, "missing required option --fhir-base-url" if fhir_base_url.empty?

  uri = URI(fhir_base_url)
  raise SeedError, "FHIR base URL must be http or https: #{fhir_base_url}" unless %w[http https].include?(uri.scheme)
end

# Contiguous household index range for this shard, per
# specs/008-echis-workload-benchmark/contracts/echis-seed-cli.md's sharding
# contract. Resource IDs below are derived only from these global indices,
# never from shard_index itself, so re-running a single shard reproduces
# byte-identical output and shards never collide regardless of run order.
start_index = (households * shard_index) / shard_count
end_index = (households * (shard_index + 1)) / shard_count

# One CHW catchment per 100 households (data-model.md), keyed by the GLOBAL
# household index so every shard independently computes the same CHW id for
# a given household without cross-shard coordination.
CHW_CATCHMENT_SIZE = 100

def chw_index_for(household_index)
  household_index / CHW_CATCHMENT_SIZE
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

def response_entries(response_body)
  parsed = JSON.parse(response_body)
  return [] unless parsed.is_a?(Hash) && parsed["resourceType"] == "Bundle"

  Array(parsed["entry"])
rescue JSON::ParserError
  []
end

def put_entry(resource)
  {
    "resource" => resource,
    "request" => { "method" => "PUT", "url" => "#{resource["resourceType"]}/#{resource["id"]}" }
  }
end

def household_id(household_index)
  format("echis-hh%08d", household_index)
end

def patient_id(individual_index)
  format("echis-p%08d", individual_index)
end

def related_person_id(individual_index)
  format("echis-rp%08d", individual_index)
end

def chw_practitioner_role_id(chw_index)
  format("echis-chw%06d", chw_index)
end

def care_team_id(chw_index)
  format("echis-ct%06d", chw_index)
end

def household_resource(household_index, member_patient_ids)
  {
    "resourceType" => "Group",
    "id" => household_id(household_index),
    "type" => "person",
    "actual" => true,
    "quantity" => member_patient_ids.length,
    "member" => member_patient_ids.map { |patient_id| { "entity" => { "reference" => "Patient/#{patient_id}" } } }
  }
end

def patient_resource(individual_index)
  id = patient_id(individual_index)
  birth_year = 1950 + (individual_index % 70)
  {
    "resourceType" => "Patient",
    "id" => id,
    "identifier" => [{ "system" => "urn:hapi-fhir-deploy:echis-benchmark", "value" => id }],
    "active" => true,
    "name" => [{ "family" => format("EchisHousehold%08d", individual_index), "given" => [format("Member%08d", individual_index)] }],
    "gender" => individual_index.even? ? "female" : "male",
    "birthDate" => format("%04d-%02d-%02d", birth_year, (individual_index % 12) + 1, (individual_index % 28) + 1)
  }
end

def related_person_resource(individual_index, head_patient_id)
  {
    "resourceType" => "RelatedPerson",
    "id" => related_person_id(individual_index),
    "patient" => { "reference" => "Patient/#{head_patient_id}" },
    "relationship" => [{
      "coding" => [{ "system" => "http://terminology.hl7.org/CodeSystem/v2-0131", "code" => "C", "display" => "Emergency Contact" }]
    }],
    "name" => [{ "family" => "EchisDependent", "given" => [format("Member%08d", individual_index)] }]
  }
end

def practitioner_role_resource(chw_index)
  {
    "resourceType" => "PractitionerRole",
    "id" => chw_practitioner_role_id(chw_index),
    "active" => true,
    "code" => [{
      "coding" => [{ "system" => "http://terminology.hl7.org/CodeSystem/practitioner-role", "code" => "chw", "display" => "Community Health Worker" }]
    }]
  }
end

def care_team_resource(chw_index)
  {
    "resourceType" => "CareTeam",
    "id" => care_team_id(chw_index),
    "status" => "active",
    "participant" => [{
      "role" => [{ "text" => "Community Health Worker" }],
      "member" => { "reference" => "PractitionerRole/#{chw_practitioner_role_id(chw_index)}" }
    }]
  }
end

def encounter_id(individual_index)
  format("echis-enc%08d", individual_index)
end

def encounter_resource(individual_index, patient_id)
  date = format("2025-%02d-%02d", (individual_index % 12) + 1, (individual_index % 28) + 1)
  {
    "resourceType" => "Encounter",
    "id" => encounter_id(individual_index),
    "status" => "finished",
    "class" => { "system" => "http://terminology.hl7.org/CodeSystem/v3-ActCode", "code" => "HH", "display" => "home health" },
    "subject" => { "reference" => "Patient/#{patient_id}" },
    "period" => { "start" => "#{date}T09:00:00Z", "end" => "#{date}T09:15:00Z" }
  }
end

OBSERVATION_CODES = [
  { "code" => "8867-4", "display" => "Heart rate", "unit" => "beats/minute", "ucum" => "/min", "min" => 60, "range" => 50 },
  { "code" => "8302-2", "display" => "Body height", "unit" => "cm", "ucum" => "cm", "min" => 50, "range" => 130 },
  { "code" => "29463-7", "display" => "Body weight", "unit" => "kg", "ucum" => "kg", "min" => 3, "range" => 80 }
].freeze

def observation_resource(individual_index, patient_id)
  selected = OBSERVATION_CODES[individual_index % OBSERVATION_CODES.length]
  date = format("2025-%02d-%02d", (individual_index % 12) + 1, (individual_index % 28) + 1)
  {
    "resourceType" => "Observation",
    "id" => format("echis-obs%08d", individual_index),
    "status" => "final",
    "code" => { "coding" => [{ "system" => "http://loinc.org", "code" => selected["code"], "display" => selected["display"] }] },
    "subject" => { "reference" => "Patient/#{patient_id}" },
    "effectiveDateTime" => "#{date}T09:05:00Z",
    "valueQuantity" => {
      "value" => selected["min"] + (individual_index % selected["range"]),
      "unit" => selected["unit"],
      "system" => "http://unitsofmeasure.org",
      "code" => selected["ucum"]
    }
  }
end

CONDITION_CODES = [
  { "code" => "38341003", "display" => "Hypertensive disorder, systemic arterial" },
  { "code" => "73211009", "display" => "Diabetes mellitus" },
  { "code" => "271737000", "display" => "Anemia" }
].freeze

# Not every individual has a Condition (data-model.md: "generated for a
# subset of individuals, not 1:1") -- every other individual, deterministically.
def condition_resource(individual_index, patient_id)
  selected = CONDITION_CODES[individual_index % CONDITION_CODES.length]
  {
    "resourceType" => "Condition",
    "id" => format("echis-cond%08d", individual_index),
    "clinicalStatus" => { "coding" => [{ "system" => "http://terminology.hl7.org/CodeSystem/condition-clinical", "code" => "active" }] },
    "verificationStatus" => { "coding" => [{ "system" => "http://terminology.hl7.org/CodeSystem/condition-ver-status", "code" => "unconfirmed" }] },
    "code" => { "coding" => [{ "system" => "http://snomed.info/sct", "code" => selected["code"], "display" => selected["display"] }] },
    "subject" => { "reference" => "Patient/#{patient_id}" }
  }
end

def questionnaire_response_resource(individual_index, patient_id)
  {
    "resourceType" => "QuestionnaireResponse",
    "id" => format("echis-qr%08d", individual_index),
    "status" => "completed",
    "subject" => { "reference" => "Patient/#{patient_id}" },
    "encounter" => { "reference" => "Encounter/#{encounter_id(individual_index)}" },
    "item" => [{ "linkId" => "danger-signs", "text" => "Any danger signs observed?", "answer" => [{ "valueBoolean" => false }] }]
  }
end

# Not every individual has an open Task -- one in three, deterministically,
# matching benchmarks/k6/lib/fhir_benchmark.js's worklist_read expecting
# status=requested (kept consistent so a load-test run against a
# echis_seed.rb-loaded dataset finds real worklist entries).
def task_resource(individual_index, patient_id, chw_index)
  {
    "resourceType" => "Task",
    "id" => format("echis-task%08d", individual_index),
    "status" => "requested",
    "intent" => "order",
    "for" => { "reference" => "Patient/#{patient_id}" },
    "owner" => { "reference" => "PractitionerRole/#{chw_practitioner_role_id(chw_index)}" }
  }
end

def resources_for_household(household_index, individuals_per_household)
  member_ids = Array.new(individuals_per_household) { |offset| patient_id((household_index * individuals_per_household) + offset) }
  chw_index = chw_index_for(household_index)
  resources = [household_resource(household_index, member_ids)]

  individuals_per_household.times do |offset|
    individual_index = (household_index * individuals_per_household) + offset
    pid = patient_id(individual_index)
    resources << patient_resource(individual_index)
    resources << related_person_resource(individual_index, member_ids.first) if offset.positive?
    resources << encounter_resource(individual_index, pid)
    resources << observation_resource(individual_index, pid)
    resources << questionnaire_response_resource(individual_index, pid)
    resources << condition_resource(individual_index, pid) if individual_index.even?
    resources << task_resource(individual_index, pid, chw_index) if (individual_index % 3).zero?
  end

  resources
end

started_at = Time.now.utc
http_status_counts = Hash.new(0)
fhir_response_status_counts = Hash.new(0)
errors = []
imported_entry_count = 0
transaction_bundle_count = 0
resource_counts = Hash.new(0)
emitted_chw_indices = Set.new

(start_index...end_index).each_slice(batch_size) do |household_indices|
  transaction_bundle_count += 1
  resources = []

  household_indices.each do |household_index|
    # emitted_chw_indices is per-invocation (per-shard), not global: if a
    # CHW's 100-household catchment straddles a shard boundary, each shard
    # that touches it will independently PUT the same PractitionerRole/
    # CareTeam once more. This is a deliberate, idempotent-safe tradeoff to
    # avoid cross-shard coordination -- it can inflate the *reported*
    # PractitionerRole/CareTeam counts slightly when multiple shards'
    # metadata are summed, but never the actual resources on a real server
    # (repeated PUTs of identical content), and never affects Group/Patient/
    # Encounter/Observation/Condition/Task/QuestionnaireResponse counts,
    # which are exclusively owned by exactly one shard's contiguous range.
    chw_index = chw_index_for(household_index)
    unless emitted_chw_indices.include?(chw_index)
      resources << practitioner_role_resource(chw_index)
      resources << care_team_resource(chw_index)
      emitted_chw_indices << chw_index
    end
    resources.concat(resources_for_household(household_index, individuals_per_household))
  end

  resources.each { |resource| resource_counts[resource["resourceType"]] += 1 }
  entries = resources.map { |resource| put_entry(resource) }
  progress_done = household_indices.last + 1 - start_index
  progress_total = end_index - start_index

  if metadata_only
    imported_entry_count += entries.length
    puts "Would import households #{progress_done}/#{progress_total} (shard #{shard_index}/#{shard_count})" if (transaction_bundle_count % 10).zero? || progress_done == progress_total
    next
  end

  bundle = { "resourceType" => "Bundle", "type" => "transaction", "entry" => entries }
  response = post_bundle(uri, bundle, timeout)
  http_status_counts[response.code] += 1

  unless response.code.to_i >= 200 && response.code.to_i < 300
    errors << { "batch" => transaction_bundle_count, "http_status" => response.code, "message" => response.body.to_s[0, 500] }
    next
  end

  entries_response = response_entries(response.body)
  if entries_response.length < entries.length
    errors << {
      "batch" => transaction_bundle_count,
      "http_status" => response.code,
      "message" => "partial transaction response: expected at least #{entries.length} entries, got #{entries_response.length}"
    }
  end

  entries_response.each do |entry|
    status = entry.dig("response", "status").to_s
    fhir_response_status_counts[status] += 1
    imported_entry_count += 1 if status_success?(status)
  end

  puts "Imported households #{progress_done}/#{progress_total} (shard #{shard_index}/#{shard_count})" if (transaction_bundle_count % 10).zero? || progress_done == progress_total
rescue StandardError => e
  errors << { "batch" => transaction_bundle_count, "message" => "#{e.class}: #{e.message}" }
end

completed_at = Time.now.utc
generated_entry_count = resource_counts.values.sum
metadata = {
  "run_id" => run_id,
  "echis" => {
    "households" => households,
    "individuals_per_household" => individuals_per_household,
    "seed" => seed,
    "generator" => "echis_seed",
    "shard_index" => shard_index,
    "shard_count" => shard_count,
    "start_index" => start_index,
    "end_index" => end_index,
    "transaction_bundle_count" => transaction_bundle_count,
    "generated_entry_count" => generated_entry_count,
    "resource_counts" => resource_counts.sort.to_h
  },
  "import" => {
    "mode" => metadata_only ? "metadata-only" : "transaction-load",
    "fhir_base_url" => metadata_only ? nil : fhir_base_url,
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
  warn "eCHIS seed failed with #{errors.length} error(s); see #{metadata_path}"
  exit 1
end

puts "Wrote eCHIS dataset metadata to #{metadata_path}"
puts "#{metadata_only ? "Would import" : "Imported"} #{imported_entry_count} resource entries#{metadata_only ? "" : " into #{fhir_base_url}"}."
rescue SeedError => e
  warn "scripts/echis_seed.rb: #{e.message}"
  exit 1
end
