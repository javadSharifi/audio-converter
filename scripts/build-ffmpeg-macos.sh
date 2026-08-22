#!/usr/bin/env bash
# Build a minimal LGPL FFmpeg (ffmpeg + ffprobe) from source on macOS.
#
# Why build instead of downloading? Prebuilt macOS FFmpeg artifacts are
# almost universally GPL builds. We only need LGPL components (native AAC/
# FLAC/PCM codecs + libmp3lame[LGPL] + libopus[BSD]), so a local build keeps
# the distribution license clean.
set -euo pipefail

VERSION="7.1.1"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_DIR="$ROOT/src-tauri/binaries/build-macos"
SRC_DIR="${TMPDIR:-/tmp}/audio-converter-ffmpeg/ffmpeg-$VERSION"

if [[ -x "$BUILD_DIR/bin/ffmpeg" && -x "$BUILD_DIR/bin/ffprobe" && "${FORCE:-0}" != "1" ]]; then
  echo "ffmpeg already built at $BUILD_DIR (set FORCE=1 to rebuild)"
  exit 0
fi

mkdir -p "$(dirname "$SRC_DIR")"
if [[ ! -d "$SRC_DIR" ]]; then
  echo "downloading ffmpeg-$VERSION source..."
  curl -fL -o "/tmp/audio-converter-ffmpeg.tar.xz" \
    "https://ffmpeg.org/releases/ffmpeg-$VERSION.tar.xz"
  mkdir -p "$SRC_DIR"
  tar xf "/tmp/audio-converter-ffmpeg.tar.xz" -C "$(dirname "$SRC_DIR")" --strip-components=1 -C "$SRC_DIR" 2>/dev/null \
    || (rm -rf "$SRC_DIR" && mkdir -p "$SRC_DIR" && tar xf "/tmp/audio-converter-ffmpeg.tar.xz" -C "$SRC_DIR" --strip-components=1)
fi

HOMEBREW_PREFIX="${HOMEBREW_PREFIX:-/opt/homebrew}"

cd "$SRC_DIR"
PKG_CONFIG_PATH="$HOMEBREW_PREFIX/lib/pkgconfig" ./configure \
  --prefix="$BUILD_DIR" \
  --disable-gpl \
  --disable-nonfree \
  --disable-doc \
  --disable-debug \
  --disable-autodetect \
  --enable-pthreads \
  --enable-libmp3lame \
  --enable-libopus \
  --enable-ffmpeg \
  --enable-ffprobe \
  --extra-cflags="-I$HOMEBREW_PREFIX/include" \
  --extra-ldflags="-L$HOMEBREW_PREFIX/lib"

make -j"$(sysctl -n hw.ncpu)"
make install

echo "built: $BUILD_DIR/bin/{ffmpeg,ffprobe}"
