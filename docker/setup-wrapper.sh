#!/bin/sh
# CLI wrapper so that "docker compose exec gateway setup" works without a TTY.
#
# Installed at /usr/local/bin/setup. Whatever way the operator calls it, the
# arguments still reach the correct subcommand.
#
#    setup                 -> memora-cli setup
#    setup --ttl 900       -> memora-cli setup --ttl 900
#    setup status          -> memora-cli status
#    setup reset-password  -> memora-cli reset-password
#    setup list            -> memora-cli list
set -e

case "${1:-}" in
  ""|--*)
    # No argument, or a leading option such as "--ttl 900": default to setup.
    exec memora-cli setup "$@"
    ;;
  setup|reset-password|reset|status|disarm|unlock|list|help|-h|version)
    exec memora-cli "$@"
    ;;
  *)
    # Unknown subcommand: pass it through so the CLI reports the real error.
    exec memora-cli "$@"
    ;;
esac
