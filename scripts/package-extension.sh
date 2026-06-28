#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PACKAGE_NAME="tab-recorder-pro"
STAGING_DIR="$ROOT_DIR/build/$PACKAGE_NAME"
BUILD_DIR="$ROOT_DIR/build"
DOWNLOAD_DIR="$ROOT_DIR/downloads"
CRX_TMP="$BUILD_DIR/$PACKAGE_NAME.crx"
KEY_FILE="$BUILD_DIR/$PACKAGE_NAME.pem"
ZIP_FILE="$DOWNLOAD_DIR/$PACKAGE_NAME.zip"
CRX_FILE="$DOWNLOAD_DIR/$PACKAGE_NAME.crx"

find_chrome_bin() {
  local candidates=(
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary"
    "/Applications/Chromium.app/Contents/MacOS/Chromium"
  )
  local candidate
  for candidate in "${candidates[@]}"; do
    if [[ -x "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

CHROME_BIN="$(find_chrome_bin || true)"

if [[ -z "$CHROME_BIN" ]]; then
  echo "Could not find a Chrome or Chromium binary to build the CRX." >&2
  exit 1
fi

rm -rf "$STAGING_DIR"
mkdir -p "$STAGING_DIR" "$DOWNLOAD_DIR" "$BUILD_DIR"

rsync -a \
  "$ROOT_DIR/manifest.json" \
  "$ROOT_DIR/contentScript.js" \
  "$ROOT_DIR/offscreen.html" \
  "$ROOT_DIR/offscreen.js" \
  "$ROOT_DIR/options.css" \
  "$ROOT_DIR/options.html" \
  "$ROOT_DIR/options.js" \
  "$ROOT_DIR/overlay.css" \
  "$ROOT_DIR/overlay.js" \
  "$ROOT_DIR/popup.css" \
  "$ROOT_DIR/popup.html" \
  "$ROOT_DIR/popup.js" \
  "$ROOT_DIR/service_worker.js" \
  "$ROOT_DIR/icons" \
  "$STAGING_DIR/"

rm -f "$ZIP_FILE" "$CRX_FILE" "$CRX_TMP"

(
  cd "$BUILD_DIR"
  zip -rq "$ZIP_FILE" "$PACKAGE_NAME"
)

if [[ -f "$KEY_FILE" ]]; then
  "$CHROME_BIN" --no-message-box --pack-extension="$STAGING_DIR" --pack-extension-key="$KEY_FILE"
else
  "$CHROME_BIN" --no-message-box --pack-extension="$STAGING_DIR"
fi

if [[ ! -f "$CRX_TMP" ]]; then
  echo "Chrome packaging did not produce a CRX file." >&2
  exit 1
fi

cp "$CRX_TMP" "$CRX_FILE"

echo "Created:"
echo "  $ZIP_FILE"
echo "  $CRX_FILE"
