# frozen_string_literal: true

require "json"
require "minitest/autorun"
require "open3"
require "rbconfig"
require "socket"
require "tmpdir"

# First automated test coverage for scripts/echis_seed.rb (spec 010,
# /speckit-tasks T002/T011/T018/T023/T030 -- spec 008's generator had none,
# per docs/echis-benchmark-tiers.md's "verified locally" manual-check
# convention). Most cases run in --metadata-only mode (no live server
# needed); the FR-010 shape-regression case uses a one-shot capturing HTTP
# server, the same pattern test/synthea_loader_http_test.rb already
# establishes, since --metadata-only never serializes resource bodies.
class EchisSeedTest < Minitest::Test
  ROOT_DIR = File.expand_path("..", __dir__)
  GENERATOR = File.join(ROOT_DIR, "scripts", "echis_seed.rb")
  ACCEPT_TIMEOUT_SECONDS = 2

  def test_resource_counts_include_new_types_at_small_scale
    metadata = run_seed(households: 100, run_id: "echis-seed-test-small")
    counts = metadata.dig("echis", "resource_counts")

    # H=100 -> C (CHW catchments) = ceil(100/100) = 1, F (facilities,
    # CHWS_PER_FACILITY=5) = ceil(1/5) = 1, sub-region = ceil(1/50) = 1,
    # region = ceil(1/20) = 1 -- data-model.md's corrected cardinality formula.
    assert_equal 3, counts["Location"]
    assert_equal 1, counts["Organization"]
    assert_equal 1, counts["Practitioner"]
    refute counts.key?("Specimen"), "Specimen must not appear unless --include-specimen is set"
  end

  def test_pre_existing_resource_counts_unchanged_by_default
    metadata = run_seed(households: 100, run_id: "echis-seed-test-unchanged")
    counts = metadata.dig("echis", "resource_counts")

    # Pre-feature (spec 008) counts for --households 100
    # --individuals-per-household 3 (SC-006 non-regression check).
    assert_equal 100, counts["Group"]
    assert_equal 300, counts["Patient"]
    assert_equal 200, counts["RelatedPerson"]
    assert_equal 1, counts["PractitionerRole"]
    assert_equal 1, counts["CareTeam"]
    assert_equal 300, counts["Encounter"]
    assert_equal 300, counts["Observation"]
    assert_equal 150, counts["Condition"]
    assert_equal 100, counts["Task"]
    assert_equal 300, counts["QuestionnaireResponse"]
  end

  def test_shard_rerun_is_byte_reproducible
    first = run_seed(households: 1000, shard_index: 0, shard_count: 4, run_id: "echis-seed-test-shard-a")
    second = run_seed(households: 1000, shard_index: 0, shard_count: 4, run_id: "echis-seed-test-shard-b")

    assert_equal first.dig("echis", "resource_counts"), second.dig("echis", "resource_counts")
  end

  def test_organization_and_practitioner_counts
    metadata = run_seed(households: 1000, run_id: "echis-seed-test-org-practitioner")
    counts = metadata.dig("echis", "resource_counts")

    assert_equal 1, counts["Organization"]
    # C = ceil(1000/100) = 10 CHW catchments -> 10 Practitioners (1 per CHW,
    # unaffected by facility grouping).
    assert_equal 10, counts["Practitioner"]
  end

  def test_specimen_absent_by_default_and_present_when_enabled
    without_flag = run_seed(households: 100, run_id: "echis-seed-test-specimen-off")
    refute without_flag.dig("echis", "resource_counts").key?("Specimen")

    with_flag = run_seed(households: 100, run_id: "echis-seed-test-specimen-on", include_specimen: true)
    counts = with_flag.dig("echis", "resource_counts")
    assert counts.key?("Specimen")
    assert counts["Specimen"].positive?
    assert_operator counts["Specimen"], :<, 300
  end

  def test_existing_resource_shapes_unchanged_except_documented_additions
    # FR-010 regression proof (spec 010 /speckit-analyze finding G3): confirm
    # the fields already implemented and reviewed under spec 008 stay exactly
    # as docs/echis-data-model.md documents them, aside from this feature's
    # explicitly-added meta.tag (Group/Task/Patient/QuestionnaireResponse)
    # and practitioner reference (PractitionerRole).
    port, server, thread = capturing_server

    Dir.mktmpdir do |dir|
      metadata_path = File.join(dir, "metadata.json")
      stdout, stderr, status = Open3.capture3(
        RbConfig.ruby, GENERATOR,
        "--households", "1",
        "--seed", "12345",
        "--run-id", "echis-seed-test-fr010",
        "--metadata", metadata_path,
        "--fhir-base-url", "http://127.0.0.1:#{port}/"
      )
      assert status.success?, "#{stdout}\n#{stderr}"
    end

    request = stop_server(server, thread)
    resources = request["entry"].map { |e| e["resource"] }

    group = resources.find { |r| r["resourceType"] == "Group" }
    assert_equal %w[actual id member meta quantity resourceType type].sort, group.keys.sort
    assert_equal "person", group["type"]
    assert_equal true, group["actual"]

    patient = resources.find { |r| r["resourceType"] == "Patient" }
    assert_equal %w[active birthDate gender id identifier meta name resourceType].sort, patient.keys.sort

    task = resources.find { |r| r["resourceType"] == "Task" }
    assert_equal %w[for id intent meta owner resourceType status].sort, task.keys.sort
    assert_equal "requested", task["status"]

    questionnaire_response = resources.find { |r| r["resourceType"] == "QuestionnaireResponse" }
    assert_equal %w[encounter id item meta resourceType status subject].sort, questionnaire_response.keys.sort

    role = resources.find { |r| r["resourceType"] == "PractitionerRole" }
    assert_equal %w[active code id practitioner resourceType].sort, role.keys.sort

    # Unmodified 008 resource types (no field additions at all in this feature).
    encounter = resources.find { |r| r["resourceType"] == "Encounter" }
    assert_equal %w[class id period resourceType status subject].sort, encounter.keys.sort
    care_team = resources.find { |r| r["resourceType"] == "CareTeam" }
    assert_equal %w[id participant resourceType status].sort, care_team.keys.sort
  ensure
    stop_server(server, thread) if server && !server.closed?
  end

  private

  def run_seed(households:, run_id:, shard_index: 0, shard_count: 1, include_specimen: false)
    Dir.mktmpdir do |dir|
      metadata_path = File.join(dir, "metadata.json")
      args = [
        RbConfig.ruby, GENERATOR,
        "--households", households.to_s,
        "--seed", "12345",
        "--run-id", run_id,
        "--metadata", metadata_path,
        "--metadata-only",
        "--shard-index", shard_index.to_s,
        "--shard-count", shard_count.to_s
      ]
      args << "--include-specimen" if include_specimen

      stdout, stderr, status = Open3.capture3(*args)
      assert status.success?, "#{stdout}\n#{stderr}"

      JSON.parse(File.read(metadata_path))
    end
  end

  # Accepts exactly one POST, captures its parsed JSON body (the transaction
  # Bundle echis_seed.rb sent), and responds with a valid transaction-response
  # Bundle so the caller doesn't report a partial-response error. Returns
  # [port, server, thread]; call stop_server(server, thread) to retrieve the
  # captured request body via Thread#value, mirroring
  # test/synthea_loader_http_test.rb's one_shot_server/stop_server pattern.
  def capturing_server
    server = TCPServer.new("127.0.0.1", 0)
    port = server.addr[1]
    thread = Thread.new do
      socket = nil
      ready = IO.select([server], nil, nil, ACCEPT_TIMEOUT_SECONDS)
      raise "timed out waiting for seed connection" unless ready

      socket = server.accept
      headers = []
      while (line = socket.gets)
        break if line == "\r\n"

        headers << line
      end
      content_length = headers.find { |line| line.downcase.start_with?("content-length:") }
        .to_s
        .split(":", 2)
        .last
        .to_i
      body = content_length.positive? ? socket.read(content_length) : ""
      request = JSON.parse(body)

      response_body = JSON.generate(
        "resourceType" => "Bundle",
        "type" => "transaction-response",
        "entry" => Array.new(Array(request["entry"]).length) { { "response" => { "status" => "200 OK" } } }
      )
      socket.write "HTTP/1.1 200 OK\r\n"
      socket.write "Content-Type: application/fhir+json\r\n"
      socket.write "Content-Length: #{response_body.bytesize}\r\n"
      socket.write "Connection: close\r\n"
      socket.write "\r\n"
      socket.write response_body

      request
    ensure
      socket&.close unless socket&.closed?
      server.close unless server.closed?
    end

    [port, server, thread]
  end

  def stop_server(server, thread)
    server&.close unless server.nil? || server.closed?
    return unless thread

    thread.join(ACCEPT_TIMEOUT_SECONDS + 1)
    raise "test server thread did not stop" if thread.alive?

    thread.value
  end
end
