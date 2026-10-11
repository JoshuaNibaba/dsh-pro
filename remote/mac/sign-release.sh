#!/usr/bin/env bash
# Signs an app in place. developer-id succeeds only after notarization and Gatekeeper acceptance.
# --check validates configuration without accessing a keychain or signing an app.
set +x
set -euo pipefail

fail() { printf 'Mac signing: %s\n' "$1" >&2; exit 1; }
mode="${REMOTE_MAC_SIGNING_MODE:-adhoc}"
case "$mode" in
  adhoc|developer-id) ;;
  *) fail 'REMOTE_MAC_SIGNING_MODE must be adhoc or developer-id.' ;;
esac
if [ "$mode" = developer-id ]; then
  for name in REMOTE_MAC_CERTIFICATE_P12_BASE64 REMOTE_MAC_CERTIFICATE_PASSWORD \
    REMOTE_MAC_SIGNING_IDENTITY REMOTE_MAC_TEAM_ID REMOTE_MAC_APPLE_ID REMOTE_MAC_APP_SPECIFIC_PASSWORD; do
    [ -n "${!name:-}" ] || fail "Missing required configuration: $name"
  done
  [[ "$REMOTE_MAC_TEAM_ID" =~ ^[A-Z0-9]{10}$ ]] || fail 'REMOTE_MAC_TEAM_ID must contain ten uppercase letters or digits.'
  [[ "$REMOTE_MAC_SIGNING_IDENTITY" == 'Developer ID Application: '*" ($REMOTE_MAC_TEAM_ID)" ]] ||
    fail 'REMOTE_MAC_SIGNING_IDENTITY must be a full Developer ID Application identity for REMOTE_MAC_TEAM_ID.'
fi
[ "${1:-}" != --check ] || exit 0
[ "$#" = 1 ] && [ -d "$1/Contents/MacOS" ] || fail 'Usage: sign-release.sh APP (existing macOS app bundle).'
app="$(cd "$1" && pwd -P)"
if [ "$mode" = adhoc ]; then
  codesign --force --deep -s - "$app"
  printf 'Mac signing: adhoc (not notarized).\n'
  exit 0
fi

umask 077
private_dir="$(mktemp -d "${TMPDIR:-/tmp}/dsh-remote-signing.XXXXXXXX")"
private_dir="$(cd "$private_dir" && pwd -P)"
keychain="$private_dir/signing.keychain-db"
original_keychains=()
restore_keychains=0
cleanup() {
  result=$?
  trap - EXIT HUP INT TERM
  set +eu
  if [ "$restore_keychains" = 1 ]; then
    security delete-keychain "$keychain" > /dev/null 2>&1
    deleted=$?
    security list-keychains -d user -s "${original_keychains[@]}" > /dev/null 2>&1
    restored=$?
    if [ "$deleted" != 0 ] || [ "$restored" != 0 ]; then
      printf 'Mac signing: temporary keychain cleanup failed.\n' >&2
      result=1
    fi
  fi
  # Only this invocation's canonical mktemp directory may be removed.
  case "$private_dir" in
    /*/dsh-remote-signing.*) rm -rf -- "${private_dir:?}" || result=1 ;;
    *) printf 'Mac signing: refusing unsafe temporary directory cleanup.\n' >&2; result=1 ;;
  esac
  exit "$result"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

# Tool output can include credentials; retain it only inside the private directory.
run_private() {
  local label="$1"
  shift
  "$@" > "$private_dir/tool.log" 2>&1 || fail "$label failed."
}
security list-keychains -d user > "$private_dir/keychains" 2> "$private_dir/tool.log" || fail 'Reading keychain search list failed.'
while IFS= read -r entry; do
  entry="${entry#*\"}"
  entry="${entry%\"*}"
  [ -z "$entry" ] || original_keychains+=("$entry")
done < "$private_dir/keychains"
keychain_password="$(openssl rand -hex 32)"
printf '%s' "$REMOTE_MAC_CERTIFICATE_P12_BASE64" | base64 --decode > "$private_dir/certificate.p12" 2> "$private_dir/tool.log" ||
  fail 'Decoding REMOTE_MAC_CERTIFICATE_P12_BASE64 failed.'
restore_keychains=1
run_private 'Creating temporary keychain' security create-keychain -p "$keychain_password" "$keychain"
run_private 'Unlocking temporary keychain' security unlock-keychain -p "$keychain_password" "$keychain"
run_private 'Setting temporary keychain lifetime' security set-keychain-settings -lut 21600 "$keychain"
run_private 'Importing signing certificate' security import "$private_dir/certificate.p12" -k "$keychain" \
  -P "$REMOTE_MAC_CERTIFICATE_PASSWORD" -T /usr/bin/codesign -T /usr/bin/security
run_private 'Granting signing access' security set-key-partition-list -S apple-tool:,apple:,codesign: \
  -s -k "$keychain_password" "$keychain"
run_private 'Signing app' codesign --force --sign "$REMOTE_MAC_SIGNING_IDENTITY" --keychain "$keychain" \
  --options runtime --timestamp --entitlements "$(dirname "$0")/entitlements.plist" "$app"
run_private 'Verifying signature' codesign --verify --deep --strict --verbose=2 \
  -R "anchor apple generic and certificate leaf[subject.OU] = \"$REMOTE_MAC_TEAM_ID\"" "$app"
codesign --display --verbose=4 "$app" > "$private_dir/signature" 2>&1 || fail 'Reading signature failed.'
grep -Fxq "Authority=$REMOTE_MAC_SIGNING_IDENTITY" "$private_dir/signature" || fail 'Signed app identity does not match REMOTE_MAC_SIGNING_IDENTITY.'
grep -Fxq "TeamIdentifier=$REMOTE_MAC_TEAM_ID" "$private_dir/signature" || fail 'Signed app team does not match REMOTE_MAC_TEAM_ID.'
grep -Eq '^CodeDirectory .*flags=.*\(.*runtime.*\)' "$private_dir/signature" || fail 'Signed app lacks hardened runtime.'
grep -Eq '^Timestamp=.+$' "$private_dir/signature" || fail 'Signed app lacks a secure timestamp.'

profile=dsh-remote-notary
run_private 'Storing notarization credentials' xcrun notarytool store-credentials "$profile" --keychain "$keychain" \
  --apple-id "$REMOTE_MAC_APPLE_ID" --team-id "$REMOTE_MAC_TEAM_ID" --password "$REMOTE_MAC_APP_SPECIFIC_PASSWORD"
unset REMOTE_MAC_CERTIFICATE_P12_BASE64 REMOTE_MAC_CERTIFICATE_PASSWORD REMOTE_MAC_APPLE_ID REMOTE_MAC_APP_SPECIFIC_PASSWORD keychain_password
run_private 'Packaging notarization submission' ditto -c -k --keepParent "$app" "$private_dir/submission.zip"
xcrun notarytool submit "$private_dir/submission.zip" --keychain "$keychain" --keychain-profile "$profile" \
  --wait --timeout 30m --output-format json > "$private_dir/notary.json" 2> "$private_dir/tool.log" || fail 'Notarization submission failed.'
status="$(plutil -extract status raw -o - "$private_dir/notary.json" 2> "$private_dir/tool.log")" || fail 'Reading notarization status failed.'
[ "$status" = Accepted ] || fail 'Notarization was not Accepted.'
run_private 'Stapling notarization ticket' xcrun stapler staple "$app"
run_private 'Validating notarization ticket' xcrun stapler validate "$app"
run_private 'Checking Gatekeeper acceptance' spctl --assess --type execute --verbose=4 "$app"
printf 'Mac signing: developer-id, notarized, stapled, Gatekeeper accepted.\n'
