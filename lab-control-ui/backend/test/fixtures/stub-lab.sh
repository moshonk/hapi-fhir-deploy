#!/usr/bin/env bash
# Stand-in for scripts/lab used by integration tests (T017). Records its own
# invocation (argv + relevant env) to $STUB_LAB_RECORD_FILE, emits scripted
# stdout/stderr lines with a configurable per-line delay, and exits with a
# configurable code -- so the action runner can be exercised without
# touching real GCP.
#
# Controlled entirely via environment variables, set by the calling test:
#   STUB_LAB_RECORD_FILE   path to append "argv: ..." to (required)
#   STUB_LAB_LINES         newline-separated lines to print to stdout (default: one line)
#   STUB_LAB_DELAY_MS      delay before each line, milliseconds (default: 0)
#   STUB_LAB_EXIT_CODE     exit code to return (default: 0)
set -euo pipefail

if [[ -n "${STUB_LAB_RECORD_FILE:-}" ]]; then
  printf 'argv:%s\n' "$*" >>"$STUB_LAB_RECORD_FILE"
fi

lines="${STUB_LAB_LINES:-stub-lab: ok}"
delay_ms="${STUB_LAB_DELAY_MS:-0}"
exit_code="${STUB_LAB_EXIT_CODE:-0}"

while IFS= read -r line; do
  if [[ "$delay_ms" -gt 0 ]]; then
    sleep "$(awk -v ms="$delay_ms" 'BEGIN { printf "%.3f", ms / 1000 }')"
  fi
  printf '%s\n' "$line"
done <<<"$lines"

exit "$exit_code"
