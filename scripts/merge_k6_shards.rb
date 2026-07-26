#!/usr/bin/env ruby
# frozen_string_literal: true

require "fileutils"
require "json"
require "optparse"

class MergeError < StandardError; end

options = {}

OptionParser.new do |opts|
  opts.banner = "Usage: scripts/merge_k6_shards.rb --shard-dir DIR --shard-count N --output FILE"
  opts.on("--shard-dir DIR", "Directory containing shard-<index>-k6-fhir-summary.json files.") { |v| options[:shard_dir] = v }
  opts.on("--shard-count N", Integer, "Expected number of shards (indices 0..N-1).") { |v| options[:shard_count] = v }
  opts.on("--output FILE", "Merged k6 FHIR summary JSON output path.") { |v| options[:output] = v }
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
  File.join(shard_dir, "shard-#{index}-k6-fhir-summary.json")
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
  raise MergeError, "missing shard k6 summary file(s) for index #{missing.join(", ")} (expected #{shard_count} shards in #{shard_dir})"
end

first_doc = present.fetch(0)

merged_total_requests = 0
merged_failed_requests = 0
merged_operation_mix = Hash.new(0)
durations = []

present.each_value do |doc|
  merged_total_requests += doc["total_requests"].to_i
  merged_failed_requests += doc["failed_requests"].to_i
  (doc["operation_mix"] || {}).each { |operation, count| merged_operation_mix[operation] += count.to_i }
  durations << doc["duration_seconds"] if doc["duration_seconds"].is_a?(Numeric)
end

# Per contracts/merged-report.md: throughput and failure rate MUST be
# recomputed from summed absolute counts over the actual run window, never
# summed or averaged directly from each shard's own rate -- per-shard rates
# can overlap in time and summing/averaging them would misrepresent the
# combined run. Wall-clock duration is the max across shards (all shards run
# the same scenario stage timings concurrently, so they finish at
# approximately the same time; the max is the closest single-number estimate
# of the combined run's actual window without requiring an explicit operator
# input).
duration_seconds = durations.max
throughput_reqs_per_sec = duration_seconds && duration_seconds.positive? ? (merged_total_requests / duration_seconds.to_f) : nil
http_failure_rate = merged_total_requests.positive? ? (merged_failed_requests.to_f / merged_total_requests) : nil

merged = {
  "profile" => first_doc["profile"],
  # Per research.md Decision 4: latency percentiles for a multi-shard tier
  # MUST come from Prometheus/Actuator, not be derived here -- averaging or
  # combining per-shard percentiles is not mathematically valid. No
  # shard-derived latency_ms field is emitted; latency_source names where the
  # real numbers come from instead.
  "latency_source" => "prometheus",
  "throughput_reqs_per_sec" => throughput_reqs_per_sec,
  "http_failure_rate" => http_failure_rate,
  "total_requests" => merged_total_requests,
  "failed_requests" => merged_failed_requests,
  "duration_seconds" => duration_seconds,
  "operation_mix" => merged_operation_mix.sort.to_h,
  "shard_count" => shard_count,
  "shard_indices_present" => present.keys.sort
}

FileUtils.mkdir_p(File.dirname(output_path))
File.write(output_path, "#{JSON.pretty_generate(merged)}\n")

puts "Merged #{shard_count} shard(s) (#{merged_total_requests} requests, #{merged_failed_requests} failed) into #{output_path}"
rescue MergeError => e
  warn "scripts/merge_k6_shards.rb: #{e.message}"
  exit 1
end
