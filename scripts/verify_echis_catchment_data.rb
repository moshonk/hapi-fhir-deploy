#!/usr/bin/env ruby
# frozen_string_literal: true

# Post-seed verification for scripts/echis_seed.rb's dev-server-aligned
# dataset. Read-only: a fixed, small set of GETs that replay the sync calls
# an OHS client makes for one Community Health Unit (the "OHS FHIR Sync --
# API Call Inventory & Performance Simulation Baseline" document), proving
# the Location hierarchy, supervision-location sync tags, household roster,
# staff chain, and reference content are all reachable. Not a load test.

require "json"
require "net/http"
require "optparse"
require "uri"

class VerifyError < StandardError; end

SUPERVISION_LOCATION_TAG_SYSTEM = "https://www.example.com/CodeSystem/supervision-location"
TAG_SCOPED_TYPES = %w[Group Patient Task QuestionnaireResponse Encounter Observation].freeze
# unit -> facility -> ward -> sub-county -> county -> country
EXPECTED_HIERARCHY_DEPTH = 6

options = { timeout: 120, unit_id: "echis-loc-chu000000" }

OptionParser.new do |opts|
  opts.banner = "Usage: scripts/verify_echis_catchment_data.rb --fhir-base-url URL [--unit-id ID] [--timeout SECONDS]"
  opts.on("--fhir-base-url URL", "FHIR base URL to verify against.") { |v| options[:fhir_base_url] = v }
  opts.on("--unit-id ID", "Community Health Unit Location id whose sync scope to verify; default echis-loc-chu000000.") { |v| options[:unit_id] = v }
  opts.on("--timeout SECONDS", Integer, "HTTP open/read timeout in seconds; default 120.") { |v| options[:timeout] = v }
  opts.on("-h", "--help", "Show this help.") do
    puts opts
    exit
  end
end.parse!

def get_json(fhir_base_url, path, timeout, description)
  target = URI("#{fhir_base_url}/#{path}")
  http = Net::HTTP.new(target.host, target.port)
  http.use_ssl = target.scheme == "https"
  http.open_timeout = timeout
  http.read_timeout = timeout
  request = Net::HTTP::Get.new(target.request_uri)
  request["Accept"] = "application/fhir+json"
  response = http.request(request)
  raise VerifyError, "#{description}: expected 2xx, got #{response.code} (GET #{path})" unless response.code.to_i.between?(200, 299)

  JSON.parse(response.body)
rescue JSON::ParserError => e
  raise VerifyError, "#{description}: invalid JSON response (GET #{path}): #{e.message}"
end

def bundle_resources(bundle, description)
  raise VerifyError, "#{description}: expected a Bundle, got #{bundle["resourceType"].inspect}" unless bundle.is_a?(Hash) && bundle["resourceType"] == "Bundle"

  Array(bundle["entry"]).map { |entry| entry["resource"] }
end

begin
  fhir_base_url = options[:fhir_base_url].to_s.sub(%r{/+\z}, "")
  raise VerifyError, "missing required option --fhir-base-url" if fhir_base_url.empty?
  raise VerifyError, "FHIR base URL must be http or https: #{fhir_base_url}" unless %w[http https].include?(URI(fhir_base_url).scheme)

  unit_id = options[:unit_id]
  timeout = options[:timeout]
  results = []

  # 1. The unit's partOf chain resolves all the way up to the country.
  chain = []
  location = get_json(fhir_base_url, "Location/#{unit_id}", timeout, "unit Location lookup")
  loop do
    chain << location["name"]
    parent = location.dig("partOf", "reference")
    break unless parent

    location = get_json(fhir_base_url, parent, timeout, "Location hierarchy lookup")
  end
  raise VerifyError, "Location hierarchy for #{unit_id} is #{chain.length} levels deep, expected #{EXPECTED_HIERARCHY_DEPTH}: #{chain.join(" -> ")}" unless chain.length == EXPECTED_HIERARCHY_DEPTH

  results << "Location hierarchy resolves: #{chain.join(" -> ")}"

  # 2. First-sync, tag-scoped pulls return only this unit's data.
  groups = []
  TAG_SCOPED_TYPES.each do |type|
    path = "#{type}?_tag=#{SUPERVISION_LOCATION_TAG_SYSTEM}|#{unit_id}&_count=50&_sort=_lastUpdated"
    resources = bundle_resources(get_json(fhir_base_url, path, timeout, "#{type} tag-scoped pull"), "#{type} tag-scoped pull")
    raise VerifyError, "#{type} tag-scoped pull returned no results for #{unit_id}" if resources.empty?

    resources.each do |resource|
      tagged = Array(resource.dig("meta", "tag")).any? { |tag| tag["system"] == SUPERVISION_LOCATION_TAG_SYSTEM && tag["code"] == unit_id }
      raise VerifyError, "#{type}/#{resource["id"]} is missing the supervision-location tag #{unit_id}" unless tagged
    end
    groups = resources if type == "Group"
    results << "#{type} tag-scoped pull returned #{resources.length} correctly tagged resource(s)"
  end

  # 3. Known-household roster read and member $everything (sync use case 2).
  group = groups.first
  roster = bundle_resources(get_json(fhir_base_url, "Group?_id=#{group["id"]}&_include=Group:member", timeout, "household roster read"), "household roster read")
  members = roster.count { |resource| resource["resourceType"] == "Patient" }
  raise VerifyError, "Group/#{group["id"]} roster read returned no Patient members" if members.zero?

  member_ref = group.dig("member", 0, "entity", "reference")
  everything = bundle_resources(get_json(fhir_base_url, "#{member_ref}/$everything", timeout, "Patient $everything"), "Patient $everything")
  results << "Group/#{group["id"]} roster includes #{members} Patient(s); #{member_ref}/$everything returned #{everything.length} resource(s)"

  # 4. Staff chain: household -> CHV PractitionerRole -> Practitioner, and the organization.
  role_ref = group.dig("managingEntity", "reference")
  raise VerifyError, "Group/#{group["id"]} has no managingEntity" unless role_ref

  role = get_json(fhir_base_url, role_ref, timeout, "CHV PractitionerRole lookup")
  practitioner_ref = role.dig("practitioner", "reference")
  raise VerifyError, "#{role_ref} has no practitioner reference" unless practitioner_ref

  get_json(fhir_base_url, practitioner_ref, timeout, "Practitioner lookup")
  get_json(fhir_base_url, "Organization/echis-org000001", timeout, "Organization lookup")
  results << "#{role_ref} -> #{practitioner_ref} resolves; Organization/echis-org000001 resolves"

  # 5. Reference content: generated responses point at loaded Questionnaires.
  response = bundle_resources(get_json(fhir_base_url, "QuestionnaireResponse?_tag=#{SUPERVISION_LOCATION_TAG_SYSTEM}|#{unit_id}&_count=1", timeout, "QuestionnaireResponse lookup"), "QuestionnaireResponse lookup").first
  canonical = response["questionnaire"]
  questionnaires = bundle_resources(get_json(fhir_base_url, "Questionnaire?url=#{URI.encode_www_form_component(canonical)}", timeout, "Questionnaire canonical lookup"), "Questionnaire canonical lookup")
  raise VerifyError, "no Questionnaire found for canonical #{canonical}" if questionnaires.empty?

  results << "QuestionnaireResponse/#{response["id"]} questionnaire #{canonical} resolves"

  puts "eCHIS dataset verification passed for unit #{unit_id}:"
  results.each { |line| puts "  - #{line}" }
rescue VerifyError => e
  warn "scripts/verify_echis_catchment_data.rb: #{e.message}"
  exit 1
end
