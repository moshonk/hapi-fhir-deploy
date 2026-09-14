#!/usr/bin/env ruby
# frozen_string_literal: true

# Snapshots the eCHIS reference content (the forms, workflows, decision rules,
# and top of the administrative Location hierarchy) from a live eCHIS FHIR
# server into benchmarks/echis/content/echis-content.json, which
# scripts/echis_seed.rb loads before generating household data. Re-run it
# whenever the dev server's content changes so seeded datasets keep matching
# what the app actually syncs.
#
# Only reference content is copied -- never patient, household, or staff
# data. Server-assigned meta (versionId/lastUpdated/source) is stripped so
# the snapshot diffs cleanly and re-PUTs as identical content.

require "fileutils"
require "json"
require "net/http"
require "optparse"
require "uri"

DEFAULT_BASE_URL = "https://echisv3.intellisoftkenya.com/fhir"
DEFAULT_OUTPUT = File.expand_path("../benchmarks/echis/content/echis-content.json", __dir__)
CONTENT_TYPES = %w[Questionnaire PlanDefinition ActivityDefinition Location].freeze
ADMINISTRATIVE_LEVEL_SYSTEM = "http://ohs.dev/codes/administrative-level"
# Only the national/county levels are real, fixed geography; everything below
# a county (sub-county, ward, facility, community health unit) is generated
# per dataset by scripts/echis_seed.rb.
SNAPSHOT_LOCATION_LEVELS = %w[country county].freeze

options = { fhir_base_url: DEFAULT_BASE_URL, output: DEFAULT_OUTPUT, timeout: 60 }

OptionParser.new do |opts|
  opts.banner = "Usage: scripts/snapshot_echis_content.rb [--fhir-base-url URL] [--output FILE]"
  opts.on("--fhir-base-url URL", "Source eCHIS FHIR server; default #{DEFAULT_BASE_URL}.") { |v| options[:fhir_base_url] = v }
  opts.on("--output FILE", "Snapshot file to write; default benchmarks/echis/content/echis-content.json.") { |v| options[:output] = v }
  opts.on("--timeout SECONDS", Integer, "HTTP open/read timeout in seconds; default 60.") { |v| options[:timeout] = v }
  opts.on("-h", "--help", "Show this help.") do
    puts opts
    exit
  end
end.parse!

def get_json(url, timeout)
  uri = URI(url)
  http = Net::HTTP.new(uri.host, uri.port)
  http.use_ssl = uri.scheme == "https"
  http.open_timeout = timeout
  http.read_timeout = timeout
  request = Net::HTTP::Get.new(uri.request_uri)
  request["Accept"] = "application/fhir+json"
  response = http.request(request)
  raise "GET #{url} returned HTTP #{response.code}" unless response.code.to_i == 200

  JSON.parse(response.body)
end

def fetch_all(base_url, type, timeout)
  resources = []
  url = "#{base_url}/#{type}?_count=200"
  while url
    bundle = get_json(url, timeout)
    resources.concat(Array(bundle["entry"]).map { |entry| entry["resource"] })
    url = Array(bundle["link"]).find { |link| link["relation"] == "next" }&.fetch("url", nil)
  end
  resources
end

def snapshot_location?(location)
  level = Array(location["type"]).flat_map { |type| Array(type["coding"]) }
    .find { |coding| coding["system"] == ADMINISTRATIVE_LEVEL_SYSTEM }
  level && SNAPSHOT_LOCATION_LEVELS.include?(level["code"])
end

begin
  base_url = options[:fhir_base_url].sub(%r{/+\z}, "")
  resources = CONTENT_TYPES.flat_map do |type|
    fetched = fetch_all(base_url, type, options[:timeout])
    fetched = fetched.select { |location| snapshot_location?(location) } if type == "Location"
    fetched.map { |resource| resource.reject { |key, _| key == "meta" } }
  end
  resources.sort_by! { |resource| [CONTENT_TYPES.index(resource["resourceType"]), resource["id"]] }

  snapshot = {
    "resourceType" => "Bundle",
    "type" => "collection",
    "meta" => { "source" => base_url },
    "entry" => resources.map { |resource| { "resource" => resource } }
  }

  FileUtils.mkdir_p(File.dirname(options[:output]))
  File.write(options[:output], "#{JSON.pretty_generate(snapshot)}\n")
  counts = resources.map { |resource| resource["resourceType"] }.tally
  puts "Wrote #{resources.length} reference resources #{counts} from #{base_url} to #{options[:output]}"
rescue StandardError => e
  warn "scripts/snapshot_echis_content.rb: #{e.class}: #{e.message}"
  exit 1
end
