# frozen_string_literal: true

require "fileutils"
require "json"
require "minitest/autorun"
require "open3"
require "rbconfig"
require "tmpdir"

# Confirms scripts/merge_seed_shards.rb correctly merges spec 010's new
# resource types (Location/Organization/Practitioner/Specimen) across
# shards with no code change to the merge script itself -- it already sums
# resource_counts generically by key (research.md Decision 5). Fixture
# shape mirrors the real shard-<index>-dataset-metadata.json files
# scripts/echis_seed.rb writes.
class MergeSeedShardsTest < Minitest::Test
  ROOT_DIR = File.expand_path("..", __dir__)
  MERGER = File.join(ROOT_DIR, "scripts", "merge_seed_shards.rb")

  def test_merges_new_resource_types_across_shards
    Dir.mktmpdir do |dir|
      write_shard(dir, 0, {
        "Group" => 50, "Patient" => 150, "Location" => 3, "Organization" => 1, "Practitioner" => 1
      })
      write_shard(dir, 1, {
        "Group" => 50, "Patient" => 150, "Location" => 3, "Organization" => 1, "Practitioner" => 1, "Specimen" => 10
      })

      output_path = File.join(dir, "merged.json")
      stdout, stderr, status = Open3.capture3(
        RbConfig.ruby, MERGER,
        "--shard-dir", dir,
        "--shard-count", "2",
        "--output", output_path
      )
      assert status.success?, "#{stdout}\n#{stderr}"

      merged = JSON.parse(File.read(output_path))
      counts = merged.dig("echis", "resource_counts")
      assert_equal 100, counts["Group"]
      assert_equal 300, counts["Patient"]
      # Location/Organization/Practitioner sum across shards even though
      # each is cross-shard-redundant by design (research.md Decision 1's
      # "Emission redundancy note") -- the merge script has no special
      # handling for that and isn't expected to (documented, accepted
      # over-count, same as the pre-existing PractitionerRole/CareTeam case).
      assert_equal 6, counts["Location"]
      assert_equal 2, counts["Organization"]
      assert_equal 2, counts["Practitioner"]
      assert_equal 10, counts["Specimen"]
    end
  end

  private

  def write_shard(dir, index, resource_counts)
    path = File.join(dir, "shard-#{index}-dataset-metadata.json")
    doc = {
      "run_id" => "merge-test",
      "echis" => {
        "generator" => "echis_seed",
        "shard_index" => index,
        "shard_count" => 2,
        "transaction_bundle_count" => 1,
        "generated_entry_count" => resource_counts.values.sum,
        "resource_counts" => resource_counts
      },
      "import" => {
        "started_at_utc" => "2026-08-17T00:00:00Z",
        "completed_at_utc" => "2026-08-17T00:01:00Z",
        "submitted_entry_count" => resource_counts.values.sum,
        "imported_entry_count" => resource_counts.values.sum,
        "error_count" => 0,
        "errors" => []
      }
    }
    File.write(path, JSON.generate(doc))
  end
end
