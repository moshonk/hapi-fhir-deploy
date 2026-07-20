# frozen_string_literal: true

require "json"
require "minitest/autorun"
require "open3"
require "rbconfig"
require "socket"
require "tmpdir"

class SyntheaLoaderHttpTest < Minitest::Test
  ROOT_DIR = File.expand_path("..", __dir__)
  LOADER = File.join(ROOT_DIR, "scripts", "synthea_loader.rb")
  FIXTURE_DIR = File.join(ROOT_DIR, "test", "fixtures", "synthea")

  def test_imports_successful_transaction_response
    body = JSON.generate(
      "resourceType" => "Bundle",
      "type" => "transaction-response",
      "entry" => [
        { "response" => { "status" => "201 Created" } },
        { "response" => { "status" => "200 OK" } }
      ]
    )
    port, server_thread = one_shot_server(body)

    Dir.mktmpdir do |dir|
      metadata_path = File.join(dir, "metadata.json")
      stdout, stderr, status = run_loader(metadata_path, "http://127.0.0.1:#{port}/fhir")

      assert status.success?, "#{stdout}\n#{stderr}"
      metadata = JSON.parse(File.read(metadata_path))
      assert_equal 0, metadata.dig("import", "error_count")
      assert_equal 2, metadata.dig("import", "imported_entry_count")
      assert_equal({ "200" => 1 }, metadata.dig("import", "http_status_counts"))
    end
  ensure
    server_thread&.join(5)
  end

  def test_fails_on_partial_transaction_response
    body = JSON.generate(
      "resourceType" => "Bundle",
      "type" => "transaction-response",
      "entry" => [
        { "response" => { "status" => "201 Created" } }
      ]
    )
    port, server_thread = one_shot_server(body)

    Dir.mktmpdir do |dir|
      metadata_path = File.join(dir, "metadata.json")
      _stdout, stderr, status = run_loader(metadata_path, "http://127.0.0.1:#{port}/fhir")

      refute status.success?, stderr
      metadata = JSON.parse(File.read(metadata_path))
      assert_equal 1, metadata.dig("import", "error_count")
      assert_match(/partial transaction response/, metadata.dig("import", "errors", 0, "message"))
    end
  ensure
    server_thread&.join(5)
  end

  private

  def run_loader(metadata_path, fhir_base_url)
    Open3.capture3(
      RbConfig.ruby,
      LOADER,
      "--input", FIXTURE_DIR,
      "--metadata", metadata_path,
      "--patients", "1",
      "--seed", "123",
      "--run-id", "test-run",
      "--fhir-base-url", fhir_base_url,
      "--timeout", "5"
    )
  end

  def one_shot_server(body)
    server = TCPServer.new("127.0.0.1", 0)
    port = server.addr[1]
    thread = Thread.new do
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
      socket.read(content_length) if content_length.positive?

      socket.write "HTTP/1.1 200 OK\r\n"
      socket.write "Content-Type: application/fhir+json\r\n"
      socket.write "Content-Length: #{body.bytesize}\r\n"
      socket.write "Connection: close\r\n"
      socket.write "\r\n"
      socket.write body
      socket.close
    ensure
      server.close
    end

    [port, thread]
  end
end
