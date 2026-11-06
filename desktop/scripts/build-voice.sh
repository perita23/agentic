#!/usr/bin/env bash
# Compiles the dictation helper (desktop/native/agentic-listen.swift) for both Mac architectures into one binary,
# desktop/build/agentic-listen, which electron-builder copies into the app's Resources. macOS only (needs Xcode's swiftc).
set -euo pipefail
cd "$(dirname "$0")/.."
out=build/agentic-listen
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
for arch in arm64 x86_64; do
  swiftc -O -target "$arch-apple-macos13.0" native/agentic-listen.swift -o "$tmp/$arch" \
    -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker native/Info.plist
done
lipo -create -output "$out" "$tmp/arm64" "$tmp/x86_64"
chmod 755 "$out"
lipo -archs "$out"
