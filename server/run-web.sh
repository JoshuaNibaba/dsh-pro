#!/usr/bin/env bash
# Runs `dsh web` for the dsh-web systemd unit. Output still goes to the journal;
# the current authenticated URL (it changes on every start) is also written to
# ~/.dsh-remote/url (mode 600) for the gateway and the DSH Remote client.
#
# Environment (set by the unit):
#   DSH_WEB_PORT      loopback port (default 18790)
#   DSH_PUBLIC_URL    optional advertised https:// root behind the gateway
#   DSH_TRUSTED_HOST  optional authority browsers use, e.g. dsh.example.com
set -euo pipefail
umask 077
state="$HOME/.dsh-remote"
mkdir -p "$state"
rm -f "$state/url"

args=(web --no-open --port "${DSH_WEB_PORT:-18790}")
# --public-url only changes the advertised URL; older dsh releases lack it.
if [ -n "${DSH_PUBLIC_URL:-}" ] && dsh web --help 2>/dev/null | grep -q -- '--public-url'; then
  args+=(--public-url "$DSH_PUBLIC_URL")
fi
[ -n "${DSH_TRUSTED_HOST:-}" ] && args+=(--trusted-host "$DSH_TRUSTED_HOST")

dsh "${args[@]}" 2>&1 | while IFS= read -r line; do
  printf '%s\n' "$line"
  case "$line" in
    "dsh web: http"*)
      url="${line#dsh web: }"
      url="${url%% *}"
      printf '%s\n' "$url" > "$state/url.tmp" && mv -f "$state/url.tmp" "$state/url"
      ;;
  esac
done
