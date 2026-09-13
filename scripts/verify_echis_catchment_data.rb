#!/usr/bin/env ruby
# frozen_string_literal: true

# Post-seed verification script for spec 010's eCHIS catchment/reference
# data (FR-011). Read-only: performs a fixed, small set of GET checks
# against a live FHIR server after scripts/echis_seed.rb has loaded a
# dataset, proving the facility hierarchy, catchment tags, Organization,
# and Practitioner data are reachable -- not a load-test workload (see
# spec.md Clarifications). Mirrors scripts/echis_seed.rb's
# SeedError/require_option/status_success? conventions, per
# specs/010-echis-additional-seed-data/contracts/echis-seed-cli-additions.md.

require "json"
require "net/http"
require "optparse"
require "uri"

class VerifyError < StandardError; end

options = { timeout: 120 }

OptionParser.new do |opts|
  opts.banner = "Usage: scripts/verify_echis_catchment_data.rb --fhir-base-url URL --facility-id ID [--timeout SECONDS]"
  opts.on("--fhir-base-url URL", "FHIR base URL to verify against.") { |v| options[:fhir_base_url] = v }
  opts.on("--facility-id ID", "Facility-level Location id to verify catchment scoping against (e.g. echis-loc-fac000000).") { |v| options[:facility_id] = v }
  opts.on("--timeout SECONDS", Integer, "HTTP open/read timeout in seconds; default 120.") { |v| options[:timeout] = v }
  opts.on("-h", "--help", "Show this help.") do
    puts opts
    exit
  end
end.parse!

begin

def require_option(options, key)
  value = options[key]
  return value unless value.nil? || value.to_s.empty?

  raise VerifyError, "missing required option --#{key.to_s.tr("_", "-")}"
end

fhir_base_url = require_option(options, :fhir_base_url).to_s.sub(%r{/+\z}, "")
facility_id = require_option(options, :facility_id)
timeout = options.fetch(:timeout)

raise VerifyError, "missing required option --fhir-base-url" if fhir_base_url.empty?

base_uri = URI(fhir_base_url)
raise VerifyError, "FHIR base URL must be http or https: #{fhir_base_url}" unless %w[http https].include?(base_uri.scheme)

def status_success?(code)
  code.to_i >= 200 && code.to_i < 300
end

def http_get(fhir_base_url, path, timeout)
  target = URI("#{fhir_base_url}/#{path}")
  http = Net::HTTP.new(target.host, target.port)
  http.use_ssl = target.scheme == "https"
  http.open_timeout = timeout
  http.read_timeout = timeout

  request = Net::HTTP::Get.new(target.request_uri)
  request["Accept"] = "application/fhir+json"
  http.request(request)
end

def get_json(fhir_base_url, path, timeout, description)
  response = http_get(fhir_base_url, path, timeout)
  raise VerifyError, "#{description}: expected 2xx, got #{response.code} (GET #{path})" unless status_success?(response.code)

  JSON.parse(response.body)
rescue JSON::ParserError => e
  raise VerifyError, "#{description}: invalid JSON response (GET #{path}): #{e.message}"
end

def bundle_entries(bundle, description)
  raise VerifyError, "#{description}: expected a Bundle, got #{bundle["resourceType"].inspect}" unless bundle.is_a?(Hash) && bundle["resourceType"] == "Bundle"

  Array(bundle["entry"])
end

CATCHMENT_TAG_SYSTEM = "urn:hapi-fhir-deploy:echis-catchment"

def assert_tag_matches(resource, facility_id, description)
  tags = Array(resource.dig("meta", "tag"))
  matching = tags.find { |tag| tag["system"] == CATCHMENT_TAG_SYSTEM && tag["code"] == facility_id }
  return if matching

  raise VerifyError, "#{description}: #{resource["resourceType"]}/#{resource["id"]} is missing the expected catchment tag (#{facility_id})"
end

results = []

# Check 1: the facility Location resolves, and its partOf chain resolves up
# through sub-region and region levels (contract check #1).
location = get_json(fhir_base_url, "Location/#{facility_id}", timeout, "facility Location lookup")
results << "Location/#{facility_id} resolves"

part_of_ref = location.dig("partOf", "reference")
if part_of_ref
  sub_region = get_json(fhir_base_url, part_of_ref, timeout, "sub-region Location lookup")
  results << "#{part_of_ref} (sub-region) resolves"

  region_ref = sub_region.dig("partOf", "reference")
  if region_ref
    get_json(fhir_base_url, region_ref, timeout, "region Location lookup")
    results << "#{region_ref} (region) resolves"
  end
end

# Checks 2-3: facility-scoped Group/Task/Patient/QuestionnaireResponse
# searches return only this facility's resources (contract checks #2-#3,
# FR-005/SC-001). Collects one Task.owner reference along the way for
# check #5.
task_owner_refs = []
%w[Group Task Patient QuestionnaireResponse].each do |resource_type|
  path = "#{resource_type}?_tag=#{CATCHMENT_TAG_SYSTEM}|#{facility_id}"
  bundle = get_json(fhir_base_url, path, timeout, "#{resource_type} facility-scoped search")
  entries = bundle_entries(bundle, "#{resource_type} facility-scoped search")
  raise VerifyError, "#{resource_type} facility-scoped search returned no results for #{facility_id}" if entries.empty?

  entries.each do |entry|
    resource = entry["resource"]
    assert_tag_matches(resource, facility_id, "#{resource_type} facility-scoped search")
    task_owner_refs << resource.dig("owner", "reference") if resource_type == "Task" && resource["owner"]
  end
  results << "#{path} returned #{entries.length} catchment-consistent result(s)"
end

# Check 4: the Organization resolves (contract check #4).
get_json(fhir_base_url, "Organization/echis-org000001", timeout, "Organization lookup")
results << "Organization/echis-org000001 resolves"

# Check 5: one PractitionerRole found above resolves its practitioner
# reference to a Practitioner (contract check #5).
role_ref = task_owner_refs.first
raise VerifyError, "no Task.owner reference found to verify PractitionerRole -> Practitioner resolution" unless role_ref

role = get_json(fhir_base_url, role_ref, timeout, "PractitionerRole lookup")
practitioner_ref = role.dig("practitioner", "reference")
raise VerifyError, "#{role_ref} has no practitioner reference" unless practitioner_ref

get_json(fhir_base_url, practitioner_ref, timeout, "Practitioner lookup")
results << "#{role_ref} -> #{practitioner_ref} resolves"

puts "eCHIS catchment data verification passed for facility #{facility_id}:"
results.each { |line| puts "  - #{line}" }
rescue VerifyError => e
  warn "scripts/verify_echis_catchment_data.rb: #{e.message}"
  exit 1
end
