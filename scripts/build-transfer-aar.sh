#!/usr/bin/env bash
# Build native/transfer into the Android .aar the app links (025 T009).
#
# NOT run by the normal build, and the artefact is gitignored. This is the second toolchain 025's
# gate warned about: it needs Go and the Android NDK, and a developer who never touches the transfer
# feature never has to install either — the TypeScript side fails soft when the .aar is absent
# (FR-013), so the app builds and runs without it, minus this one feature.
#
#   ./scripts/build-transfer-aar.sh            # arm64 only, which is what a phone needs
#   ./scripts/build-transfer-aar.sh android    # all four ABIs, ~4x the size
set -euo pipefail

TARGET="${1:-android/arm64}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/android/app/libs/obalkatransfer.aar"

command -v go >/dev/null || { echo "go is not installed - see specs/025-phone-to-phone-transfer/tasks.md"; exit 1; }
: "${ANDROID_NDK_HOME:?set ANDROID_NDK_HOME to an installed NDK}"

export PATH="$(go env GOPATH)/bin:$PATH"
command -v gomobile >/dev/null || go install golang.org/x/mobile/cmd/gomobile@latest
gomobile init

mkdir -p "$(dirname "$OUT")"
cd "$ROOT/native/transfer"
gomobile bind -target="$TARGET" -androidapi 24 -o "$OUT" .
ls -l "$OUT"
