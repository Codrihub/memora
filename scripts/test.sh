#!/bin/sh
# Run the Rust test suite with every temporary vault and state folder in one
# fresh directory outside the repository, then remove it, so test runs never
# pile up in /tmp (and vault tests can never touch this git checkout).
#   scripts/test.sh            all tests
#   scripts/test.sh -p memora-core resource_tests
set -u
tmp=$(mktemp -d "${TMPDIR:-/tmp}/memora-test.XXXXXX") || exit 1
if [ $# -eq 0 ]; then set -- --workspace; fi
TMPDIR="$tmp" cargo test "$@"
status=$?
rm -rf "$tmp"
exit $status
