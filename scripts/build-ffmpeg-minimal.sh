#!/usr/bin/env bash
# Build a minimal, FULLY STATIC (except system libs) LGPL FFmpeg
# (ffmpeg + ffprobe) for macOS or Linux, from official sources.
#
# lame (LGPL) and opus (BSD) are compiled from source and linked statically,
# so the resulting binaries run on machines with no Homebrew / no distro
# dev packages — and stay small compared to "kitchen sink" builds.
set -euo pipefail

FF_VERSION="8.1.2"
LAME_VERSION="3.100"
OPUS_VERSION="1.6.1"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_DIR="$ROOT/src-tauri/binaries/build-minimal"
DEPS="$BUILD_DIR/deps"
CACHE="${TMPDIR:-/tmp}/audio-converter-src"

TARGET_TRIPLE="${TARGET_TRIPLE:-}"
IS_ANDROID=0
if [[ "$TARGET_TRIPLE" == *"android"* ]]; then
  IS_ANDROID=1
fi

if [[ "$IS_ANDROID" == "1" ]]; then
  # Derive arch/host/compiler from the target triple so --target armv7/x86_64
  # actually produces matching binaries (previously hardcoded to aarch64).
  case "$TARGET_TRIPLE" in
    aarch64-linux-android)
      ANDROID_ARCH="aarch64"; ANDROID_HOST="aarch64-linux-android"; ANDROID_CPU="armv8-a"
      ANDROID_CC="aarch64-linux-android24-clang"
      ;;
    armv7-linux-androideabi)
      ANDROID_ARCH="arm"; ANDROID_HOST="arm-linux-androideabi"; ANDROID_CPU="armv7-a"
      ANDROID_CC="armv7a-linux-androideabi24-clang"
      ;;
    x86_64-linux-android)
      ANDROID_ARCH="x86_64"; ANDROID_HOST="x86_64-linux-android"; ANDROID_CPU="x86_64"
      ANDROID_CC="x86_64-linux-android24-clang"
      ;;
    i686-linux-android)
      ANDROID_ARCH="i686"; ANDROID_HOST="i686-linux-android"; ANDROID_CPU="i686"
      ANDROID_CC="i686-linux-android24-clang"
      ;;
    *)
      echo "Unsupported Android target triple: $TARGET_TRIPLE"; exit 1
      ;;
  esac

  BUILD_DIR="$ROOT/src-tauri/binaries/build-minimal-android-$ANDROID_ARCH"
  DEPS="$BUILD_DIR/deps"

  NDK_DIR="${NDK_HOME:-${ANDROID_NDK_HOME:-}}"
  if [[ -z "$NDK_DIR" || ! -d "$NDK_DIR" ]]; then
    echo "NDK_HOME not set or not found for Android build: $NDK_DIR"
    exit 1
  fi

  TOOLCHAIN=""
  for prebuilt in linux-x86_64 darwin-x86_64 darwin-arm64 windows-x86_64; do
    candidate="$NDK_DIR/toolchains/llvm/prebuilt/$prebuilt"
    if [[ -d "$candidate" ]]; then TOOLCHAIN="$candidate"; break; fi
  done
  if [[ -z "$TOOLCHAIN" ]]; then
    echo "No NDK toolchain prebuilt found (looked for linux-x86_64, darwin-*, windows-x86_64)"
    exit 1
  fi

  CC="$TOOLCHAIN/bin/$ANDROID_CC"
  CXX="${CC}++"
  AR="$TOOLCHAIN/bin/llvm-ar"
  RANLIB="$TOOLCHAIN/bin/llvm-ranlib"
  STRIP="$TOOLCHAIN/bin/llvm-strip"
  SYSROOT="$TOOLCHAIN/sysroot"
  # Android 15+ devices ship 16KB memory pages; Play requires 16KB-aligned
  # ELF segments for targetSdk 35+. Explicit flag works on NDK r26+.
  ANDROID_LINK_FLAGS="-Wl,-z,max-page-size=16384"
fi

if [[ -x "$BUILD_DIR/bin/ffmpeg" && -x "$BUILD_DIR/bin/ffprobe" && "${FORCE:-0}" != "1" ]]; then
  echo "minimal ffmpeg already built at $BUILD_DIR (FORCE=1 to rebuild)"
  exit 0
fi

mkdir -p "$DEPS" "$CACHE"
JOBS="$(getconf _NPROCESSORS_ONLN 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)"

fetch() { # $1=url  $2=name
  local url="$1" name="$2"
  if [[ ! -f "$CACHE/$name" ]]; then
    echo "downloading $name..."
    curl -fL -o "$CACHE/$name" "$url"
  fi
}

build_lame() {
  if [[ -f "$DEPS/lib/libmp3lame.a" ]]; then echo "lame: cached"; return; fi
  fetch "https://downloads.sourceforge.net/project/lame/lame/$LAME_VERSION/lame-$LAME_VERSION.tar.gz" "lame.tar.gz"
  rm -rf "$CACHE/lame" && mkdir -p "$CACHE/lame" && tar xzf "$CACHE/lame.tar.gz" -C "$CACHE/lame" --strip-components=1
  if [[ "$IS_ANDROID" == "1" ]]; then
    (cd "$CACHE/lame" && ./configure --host="$ANDROID_HOST" --prefix="$DEPS" CC="$CC" AR="$AR" RANLIB="$RANLIB" --disable-shared --enable-static --disable-frontend --disable-debug && make -j"$JOBS" && make install)
  else
    (cd "$CACHE/lame" && ./configure --prefix="$DEPS" --disable-shared --enable-static --disable-frontend --disable-debug && make -j"$JOBS" && make install)
  fi
  patch_pc
  echo "lame: built"
}

# Static libs on glibc/android need libm at link time; ffmpeg's pkg-config link
# test drops -lm placed before -lopus under --as-needed, so append it to
# the pc file's Libs line (keeps -lopus first).
patch_pc() {
  sed -i.bak 's/^Libs: \(.*\)$/Libs: \1 -lm/' "$DEPS"/lib/pkgconfig/*.pc 2>/dev/null || true
  rm -f "$DEPS"/lib/pkgconfig/*.pc.bak 2>/dev/null || true
}

build_opus() {
  if [[ -f "$DEPS/lib/libopus.a" ]]; then echo "opus: cached"; return; fi
  fetch "https://downloads.xiph.org/releases/opus/opus-$OPUS_VERSION.tar.gz" "opus.tar.gz"
  rm -rf "$CACHE/opus" && mkdir -p "$CACHE/opus" && tar xzf "$CACHE/opus.tar.gz" -C "$CACHE/opus" --strip-components=1
  if [[ "$IS_ANDROID" == "1" ]]; then
    (cd "$CACHE/opus" && ./configure --host="$ANDROID_HOST" --prefix="$DEPS" CC="$CC" AR="$AR" RANLIB="$RANLIB" --disable-shared --enable-static --disable-doc --disable-extra-programs \
      && make -j"$JOBS" && make install)
  else
    (cd "$CACHE/opus" && ./configure --prefix="$DEPS" --disable-shared --enable-static --disable-doc --disable-extra-programs \
      && make -j"$JOBS" && make install)
  fi
  patch_pc
  echo "opus: built"
}

build_ffmpeg() {
  if [[ -x "$BUILD_DIR/bin/ffmpeg" && -x "$BUILD_DIR/bin/ffprobe" ]]; then echo "ffmpeg: cached"; return; fi
  fetch "https://ffmpeg.org/releases/ffmpeg-$FF_VERSION.tar.xz" "ffmpeg.tar.xz"
  rm -rf "$CACHE/ffmpeg" && mkdir -p "$CACHE/ffmpeg" && tar xJf "$CACHE/ffmpeg.tar.xz" -C "$CACHE/ffmpeg" --strip-components=1
  
  if [[ "$IS_ANDROID" == "1" ]]; then
    (cd "$CACHE/ffmpeg" && PKG_CONFIG_PATH="$DEPS/lib/pkgconfig" ./configure \
      --prefix="$BUILD_DIR" \
      --enable-cross-compile \
      --target-os=android \
      --arch="$ANDROID_ARCH" \
      --cpu="$ANDROID_CPU" \
      --cc="$CC" \
      --cxx="$CXX" \
      --ar="$AR" \
      --ranlib="$RANLIB" \
      --strip="$STRIP" \
      --sysroot="$SYSROOT" \
      --disable-gpl --disable-nonfree --disable-doc --disable-debug --disable-autodetect \
      --enable-pthreads \
      --enable-libmp3lame --enable-libopus \
      --enable-ffmpeg --enable-ffprobe \
      --extra-cflags="-I$DEPS/include -fPIE -fPIC" \
      --extra-ldflags="-L$DEPS/lib -pie $ANDROID_LINK_FLAGS" \
      --disable-x86asm \
      && make -j"$JOBS" && make install) \
    || { echo "=== FFMPEG ANDROID BUILD FAILED — config.log tail ==="; tail -40 "$CACHE/ffmpeg/ffbuild/config.log" 2>/dev/null; exit 1; }
  else
    local asm_flag=""
    command -v nasm >/dev/null 2>&1 || asm_flag="--disable-x86asm"
    (cd "$CACHE/ffmpeg" && PKG_CONFIG_PATH="$DEPS/lib/pkgconfig" ./configure \
      --prefix="$BUILD_DIR" \
      --disable-gpl --disable-nonfree --disable-doc --disable-debug --disable-autodetect \
      --enable-pthreads \
      --enable-libmp3lame --enable-libopus \
      --enable-ffmpeg --enable-ffprobe \
      --extra-cflags="-I$DEPS/include" \
      --extra-ldflags="-L$DEPS/lib -lm" \
      $asm_flag \
      && make -j"$JOBS" && make install) \
    || { echo "=== FFMPEG BUILD FAILED — config.log tail ==="; tail -40 "$CACHE/ffmpeg/ffbuild/config.log" 2>/dev/null; exit 1; }
  fi
  echo "ffmpeg: built"
}

build_lame
build_opus
build_ffmpeg

if [[ "$IS_ANDROID" == "1" ]]; then
  echo "stripping Android binaries with $STRIP..."
  "$STRIP" "$BUILD_DIR/bin/ffmpeg" "$BUILD_DIR/bin/ffprobe" || true
fi

echo "done: $BUILD_DIR/bin/{ffmpeg,ffprobe}"
ls -lh "$BUILD_DIR/bin/"