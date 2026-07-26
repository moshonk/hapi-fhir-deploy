#!/usr/bin/env ruby
# frozen_string_literal: true

require "fileutils"
require "json"
require "optparse"

class MergeError < StandardError; end

options = {}

OptionParser.new do |opts|
  opts.banner = "Usage: scripts/merge_seed_shards.rb --shard-dir DIR --shard-count N --output FILE"
  opts.on("--shard-dir DIR", "Directory containing shard-<index>-dataset-metadata.json files.") { |v| options[:shard_dir] = v }
  opts.on("--shard-count N", Integer, "Expected number of shards (indices 0..N-1).") { |v| options[:shard_count] = v }
  opts.on("--output FILE", "Merged dataset metadata JSON output path.") { |v| options[:output] = v }
  opts.on("-h", "--help", "Show this help.") do
    puts opts
    exit
  end
end.parse!

begin

def require_option(options, key)
  value = options[key]
  return value unless value.nil? || value.to_s.empty?

  raise MergeError, "missing required option --#{key.to_s.tr("_", "-")}"
end

def shard_file(shard_dir, index)
  File.join(shard_dir, "shard-#{index}-dataset-metadata.json")
end

# The generator-specific block sits under a top-level key that varies by
# generator (minimal_fhir_seed.rb uses "synthea", echis_seed.rb uses "echis"),
# per contracts/echis-seed-cli.md and the pre-existing minimal_fhir_seed.rb
# metadata shape. Detecting it dynamically lets this script merge shards from
# either generator without a --generator flag.
def generator_key(doc)
  (doc.keys - %w[run_id import created_at_utc completed_at_utc]).first
end

shard_dir = require_option(options, :shard_dir)
shard_count = require_option(options, :shard_count)
output_path = require_option(options, :output)
raise MergeError, "--shard-count must be greater than zero" unless shard_count.positive?
raise MergeError, "shard directory not found: #{shard_dir}" unless Dir.exist?(shard_dir)

present = {}
missing = []
(0...shard_count).each do |index|
  path = shard_file(shard_dir, index)
  if File.exist?(path)
    present[index] = JSON.parse(File.read(path))
  else
    missing << index
  end
end

unless missing.empty?
  raise MergeError, "missing shard metadata file(s) for index #{missing.join(", ")} (expected #{shard_count} shards in #{shard_dir})"
end

first_doc = present.fetch(0)
key = generator_key(first_doc)
raise MergeError, "could not determine the generator-specific key in shard 0's metadata" if key.nil?

merged_resource_counts = Hash.new(0)
merged_transaction_bundle_count = 0
merged_generated_entry_count = 0
merged_imported_entry_count = 0
merged_error_count = 0
merged_errors = []
started_ats = []
completed_ats = []

present.each do |index, doc|
  doc_key = generator_key(doc)
  if doc_key != key
    raise MergeError, "shard #{index} metadata uses generator key #{doc_key.inspect}, expected #{key.inspect} (matching shard 0) -- shards from different generators cannot be merged together"
  end

  section = doc[key] || {}
  (section["resource_counts"] || {}).each { |type, count| merged_resource_counts[type] += count.to_i }
  merged_transaction_bundle_count += section["transaction_bundle_count"].to_i
  merged_generated_entry_count += section["generated_entry_count"].to_i

  import = doc["import"] || {}
  merged_imported_entry_count += import["imported_entry_count"].to_i
  merged_error_count += import["error_count"].to_i
  Array(import["errors"]).each { |error| merged_errors << error.merge("shard_index" => index) }
  started_ats << import["started_at_utc"] if import["started_at_utc"]
  completed_ats << import["completed_at_utc"] if import["completed_at_utc"]
end

merged = {
  "run_id" => first_doc["run_id"],
  key => {
    "generator" => (first_doc[key] || {})["generator"],
    "shard_count" => shard_count,
    "shard_indices_present" => present.keys.sort,
    "transaction_bundle_count" => merged_transaction_bundle_count,
    "generated_entry_count" => merged_generated_entry_count,
    "resource_counts" => merged_resource_counts.sort.to_h
  },
  "import" => {
    "started_at_utc" => started_ats.min,
    "completed_at_utc" => completed_ats.max,
    "submitted_entry_count" => merged_generated_entry_count,
    "imported_entry_count" => merged_imported_entry_count,
    "error_count" => merged_error_count,
    "errors" => merged_errors
  }
}

FileUtils.mkdir_p(File.dirname(output_path))
File.write(output_path, "#{JSON.pretty_generate(merged)}\n")

puts "Merged #{shard_count} shard(s) (#{merged_generated_entry_count} entries, #{merged_error_count} error(s)) into #{output_path}"
rescue MergeError => e
  warn "scripts/merge_seed_shards.rb: #{e.message}"
  exit 1
end
