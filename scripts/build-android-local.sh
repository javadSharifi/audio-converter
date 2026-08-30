#!/usr/bin/env bash
# ==============================================================================
# Local Android Build & Sign Script for Audio Converter (macOS & Linux)
# Mirrors the CI workflow in .github/workflows/release.yml
# ==============================================================================
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

START_TIME=$(date +%s)
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo -e "${CYAN}${BOLD}=== Audio Converter: Local Android Build ===${NC}\n"

# ------------------------------------------------------------------------------
# 0. Load optional local environment files for secrets
# ------------------------------------------------------------------------------
for env_file in "$ROOT/.env.android" "$ROOT/.env.local" "$ROOT/secrets.android.env"; do
  if [ -f "$env_file" ]; then
    echo -e "${BLUE}ℹ Loading environment variables from $(basename "$env_file")${NC}"
    # shellcheck disable=SC1090
    set -a
    source "$env_file"
    set +a
    break
  fi
done

# ------------------------------------------------------------------------------
# 1. Parse Arguments
# ------------------------------------------------------------------------------
BUILD_MODE="release"
REBUILD_FFMPEG=0
SKIP_SIGN=0
TARGET_ARCH="aarch64"
TARGET_TRIPLE="aarch64-linux-android"
JNI_DIR="arm64-v8a"

while [[ $# -gt 0 ]]; do
  case $1 in
    --debug)
      BUILD_MODE="debug"
      shift
      ;;
    --release)
      BUILD_MODE="release"
      shift
      ;;
    --rebuild-ffmpeg|--force-ffmpeg)
      REBUILD_FFMPEG=1
      shift
      ;;
    --skip-sign)
      SKIP_SIGN=1
      shift
      ;;
    --target)
      TARGET_ARCH="$2"
      shift 2
      ;;
    -h|--help)
      echo "Usage: ./scripts/build-android-local.sh [options]"
      echo ""
      echo "Options:"
      echo "  --release           Build release APK (default, signed)"
      echo "  --debug             Build debug APK"
      echo "  --rebuild-ffmpeg    Force recompile FFmpeg/FFprobe for Android"
      echo "  --skip-sign         Skip APK signing step"
      echo "  --target <arch>     Target architecture (default: aarch64)"
      echo "  -h, --help          Show this help message"
      exit 0
      ;;
    *)
      echo -e "${RED}Unknown argument: $1${NC}"
      exit 1
      ;;
  esac
done

if [ "$TARGET_ARCH" = "aarch64" ] || [ "$TARGET_ARCH" = "arm64" ]; then
  TARGET_ARCH="aarch64"
  TARGET_TRIPLE="aarch64-linux-android"
  JNI_DIR="arm64-v8a"
elif [ "$TARGET_ARCH" = "armv7" ] || [ "$TARGET_ARCH" = "arm" ]; then
  TARGET_TRIPLE="armv7-linux-androideabi"
  JNI_DIR="armeabi-v7a"
elif [ "$TARGET_ARCH" = "x86_64" ] || [ "$TARGET_ARCH" = "x64" ]; then
  TARGET_TRIPLE="x86_64-linux-android"
  JNI_DIR="x86_64"
elif [ "$TARGET_ARCH" = "i686" ] || [ "$TARGET_ARCH" = "x86" ]; then
  TARGET_TRIPLE="i686-linux-android"
  JNI_DIR="x86"
fi

# ------------------------------------------------------------------------------
# 2. Check and configure environment prerequisites (Java, Android SDK, NDK, Rust)
# ------------------------------------------------------------------------------
echo -e "${BLUE}▶ Checking environment prerequisites...${NC}"

# JAVA_HOME resolution (macOS / Linux / Windows-GitBash)
if [ -z "${JAVA_HOME:-}" ] || [ ! -d "${JAVA_HOME:-}" ]; then
  if command -v /usr/libexec/java_home >/dev/null 2>&1; then
    JAVA_HOME="$(/usr/libexec/java_home -v 17 2>/dev/null || /usr/libexec/java_home 2>/dev/null || true)"
  fi
  if [ -z "${JAVA_HOME:-}" ]; then
    for cand in \
      "/opt/homebrew/opt/openjdk@17" \
      "/opt/homebrew/opt/openjdk" \
      "/Applications/Android Studio.app/Contents/jbr/Contents/Home" \
      "/c/Program Files/Android/Android Studio/jbr" \
      "/c/Program Files/Java/jdk-17" \
      "/c/Program Files/Eclipse Adoptium/jdk-17" \
      "$LOCALAPPDATA/Programs/Android Studio/jbr"; do
      if [ -d "$cand" ]; then JAVA_HOME="$cand"; break; fi
    done
  fi
fi

if [ -z "${JAVA_HOME:-}" ] || [ ! -d "$JAVA_HOME" ]; then
  echo -e "${RED}✘ JAVA_HOME is not set or valid JDK not found.${NC}"
  echo -e "  Please install OpenJDK 17 via Homebrew:"
  echo -e "  ${YELLOW}brew install openjdk@17${NC}"
  echo -e "  Then add to ~/.zshrc:"
  echo -e "  ${YELLOW}export JAVA_HOME=\"/opt/homebrew/opt/openjdk@17\"${NC}"
  exit 1
fi
export JAVA_HOME
export PATH="$JAVA_HOME/bin:$PATH"
echo -e "  ${GREEN}✔${NC} Java JDK: $JAVA_HOME ($("$JAVA_HOME/bin/java" -version 2>&1 | head -n 1))"

# ANDROID_HOME resolution (macOS / Windows-GitBash)
if [ -z "${ANDROID_HOME:-}" ] || [ ! -d "${ANDROID_HOME:-}" ]; then
  for cand in \
    "$HOME/Library/Android/sdk" \
    "$LOCALAPPDATA/Android/Sdk" \
    "/c/Users/$USER/AppData/Local/Android/Sdk" \
    "/opt/homebrew/share/android-commandlinetools"; do
    if [ -d "$cand" ]; then ANDROID_HOME="$cand"; break; fi
  done
fi

if [ -z "${ANDROID_HOME:-}" ] || [ ! -d "$ANDROID_HOME" ]; then
  echo -e "${RED}✘ ANDROID_HOME is not set or valid Android SDK not found.${NC}"
  echo -e "  Please install Android SDK (via Android Studio or brew install --cask android-commandlinetools)."
  echo -e "  Then add to ~/.zshrc:"
  echo -e "  ${YELLOW}export ANDROID_HOME=\"\$HOME/Library/Android/sdk\"${NC}"
  exit 1
fi
export ANDROID_HOME

# NDK_HOME resolution
if [ -z "${NDK_HOME:-}" ] || [ ! -d "${NDK_HOME:-}" ]; then
  if [ -d "$ANDROID_HOME/ndk" ]; then
    # Pick highest version installed in ndk directory (find -L to follow symlinks)
    LATEST_NDK="$(find -L "$ANDROID_HOME/ndk" -maxdepth 1 -mindepth 1 2>/dev/null | sort -V | tail -n 1)"
    if [ -n "$LATEST_NDK" ] && [ -d "$LATEST_NDK" ]; then
      NDK_HOME="$LATEST_NDK"
    fi
  elif [ -d "$ANDROID_HOME/ndk-bundle" ]; then
    NDK_HOME="$ANDROID_HOME/ndk-bundle"
  fi
fi

if [ -z "${NDK_HOME:-}" ] || [ ! -d "$NDK_HOME" ]; then
  echo -e "${RED}✘ NDK_HOME is not set or Android NDK not found in $ANDROID_HOME/ndk.${NC}"
  echo -e "  Please install NDK (via Android Studio SDK Manager -> SDK Tools -> NDK or via sdkmanager 'ndk;26.3.11579264')."
  echo -e "  Then add to ~/.zshrc:"
  echo -e "  ${YELLOW}export NDK_HOME=\"\$ANDROID_HOME/ndk/<version>\"${NC}"
  exit 1
fi
export NDK_HOME
export ANDROID_NDK_HOME="$NDK_HOME"
echo -e "  ${GREEN}✔${NC} Android SDK: $ANDROID_HOME"
echo -e "  ${GREEN}✔${NC} Android NDK: $NDK_HOME"

# PATH additions
export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH"
BUILD_TOOLS_DIR="$(find -L "$ANDROID_HOME/build-tools" -maxdepth 1 -mindepth 1 2>/dev/null | sort -V | tail -n 1 || true)"
if [ -n "$BUILD_TOOLS_DIR" ]; then
  export PATH="$BUILD_TOOLS_DIR:$PATH"
fi

# Check Rust target
if ! rustup target list --installed | grep -q "^${TARGET_TRIPLE}$"; then
  echo -e "  ${YELLOW}⚠ Target $TARGET_TRIPLE not installed in rustup. Installing...${NC}"
  rustup target add "$TARGET_TRIPLE"
fi
echo -e "  ${GREEN}✔${NC} Rust target: $TARGET_TRIPLE"

# ------------------------------------------------------------------------------
# 3. Build / Fetch FFmpeg binaries for Android
# ------------------------------------------------------------------------------
echo -e "\n${BLUE}▶ Checking Android FFmpeg / FFprobe binaries...${NC}"
FFMPEG_BIN="$ROOT/src-tauri/binaries/ffmpeg-$TARGET_TRIPLE"
FFPROBE_BIN="$ROOT/src-tauri/binaries/ffprobe-$TARGET_TRIPLE"

if [ $REBUILD_FFMPEG -eq 1 ] || [ ! -f "$FFMPEG_BIN" ] || [ ! -f "$FFPROBE_BIN" ]; then
  echo -e "${YELLOW}Building minimal FFmpeg + FFprobe for $TARGET_TRIPLE (LGPL)...${NC}"
  TARGET_TRIPLE="$TARGET_TRIPLE" pnpm fetch:ffmpeg
else
  echo -e "${GREEN}✔${NC} Existing Android FFmpeg binaries found in src-tauri/binaries/."
fi

# ------------------------------------------------------------------------------
# 4. Initialize & Configure Tauri Android Project
# ------------------------------------------------------------------------------
echo -e "\n${BLUE}▶ Preparing Android project files...${NC}"

if [ ! -d "$ROOT/src-tauri/gen/android" ]; then
  echo -e "${YELLOW}Initializing Tauri Android project (pnpm tauri android init)...${NC}"
  pnpm tauri android init
fi

if [ ! -d "$ROOT/src-tauri/gen/android" ]; then
  echo -e "${YELLOW}Initializing Tauri Android project (pnpm tauri android init)...${NC}"
  pnpm tauri android init
fi

# Apply ALL project patches through the shared patcher (same as CI):
# icons, strings, useLegacyPackaging, media permissions, MainActivity.kt,
# and ffmpeg/ffprobe as lib*.so into jniLibs.
bash "$ROOT/scripts/patch-android-project.sh" "$TARGET_TRIPLE"

# ------------------------------------------------------------------------------
# 5. Type verification & Frontend / Android build
# ------------------------------------------------------------------------------
echo -e "\n${BLUE}▶ Generating Specta TypeScript bindings...${NC}"
pnpm generate:types
pnpm check:types

echo -e "\n${BLUE}▶ Running Tauri Android Build ($BUILD_MODE, target: $TARGET_ARCH)...${NC}"
if [ "$BUILD_MODE" = "debug" ]; then
  pnpm tauri android build --apk --target "$TARGET_ARCH" --debug
else
  pnpm tauri android build --apk --target "$TARGET_ARCH"
fi

# ------------------------------------------------------------------------------
# 6. Verify APK Contents
# ------------------------------------------------------------------------------
echo -e "\n${BLUE}▶ Verifying APK structure...${NC}"
RAW_APK=$(find "$ROOT/src-tauri/gen/android/app/build/outputs/apk" -name "*.apk" 2>/dev/null | sort | tail -n 1)

if [ -z "$RAW_APK" ] || [ ! -f "$RAW_APK" ]; then
  echo -e "${RED}✘ Error: No APK found in build/outputs/apk!${NC}"
  exit 1
fi

echo "Inspecting $RAW_APK..."
APK_CONTENTS=$(unzip -l "$RAW_APK")
if ! echo "$APK_CONTENTS" | grep -q "lib/$JNI_DIR/libffmpeg.so"; then
  echo -e "${RED}✘ FATAL: lib/$JNI_DIR/libffmpeg.so is missing from the built APK!${NC}"
  exit 1
fi
if ! echo "$APK_CONTENTS" | grep -q "lib/$JNI_DIR/libffprobe.so"; then
  echo -e "${RED}✘ FATAL: lib/$JNI_DIR/libffprobe.so is missing from the built APK!${NC}"
  exit 1
fi
echo -e "${GREEN}✔ Verification passed: libffmpeg.so & libffprobe.so present in APK.${NC}"

# Assert runtime media permissions survived into the built manifest — an APK
# without them silently fails to open any user-picked media file.
AAPT2="$(find -L "$ANDROID_HOME/build-tools" \( -name aapt2 -o -name aapt2.exe \) 2>/dev/null | sort -V | tail -n 1)"
if [ -n "$AAPT2" ]; then
  if ! "$AAPT2" dump permissions "$RAW_APK" | grep -q "READ_MEDIA"; then
    echo -e "${RED}✘ FATAL: READ_MEDIA_* permissions missing from built APK manifest!${NC}"
    exit 1
  fi
  echo -e "${GREEN}✔ Verification passed: media permissions present in APK.${NC}"
else
  echo -e "${YELLOW}⚠ aapt2 not found — skipping permission assertion.${NC}"
fi

# ------------------------------------------------------------------------------
# 7. APK Signing
# ------------------------------------------------------------------------------
FINAL_APK="$RAW_APK"

if [ $SKIP_SIGN -eq 0 ]; then
  echo -e "\n${BLUE}▶ Signing APK...${NC}"
  APKSIGNER=$(find -L "$ANDROID_HOME/build-tools" -name apksigner 2>/dev/null | sort -V | tail -n 1)
  
  if [ -z "$APKSIGNER" ] || [ ! -x "$APKSIGNER" ]; then
    echo -e "${YELLOW}⚠ apksigner tool not found in $ANDROID_HOME/build-tools. Skipping signing.${NC}"
  else
    KEYSTORE_DIR="$HOME/.android"
    mkdir -p "$KEYSTORE_DIR"
    
    KS_PATH="${KEYSTORE_PATH:-$KEYSTORE_DIR/release.keystore}"
    KS_PASS="${KEYSTORE_PASSWORD:-audioconverter123}"
    K_ALIAS="${KEY_ALIAS:-audioconverter}"
    K_PASS="${KEY_PASSWORD:-audioconverter123}"

    if [ -n "${KEYSTORE_BASE64:-}" ]; then
      echo "Decoding KEYSTORE_BASE64 to $KS_PATH..."
      echo "$KEYSTORE_BASE64" | base64 --decode > "$KS_PATH"
    elif [ -f "$KS_PATH" ]; then
      echo -e "${GREEN}✔ Using existing persistent release keystore at: $KS_PATH${NC}"
    else
      echo -e "${YELLOW}No keystore found at $KS_PATH. Generating permanent local release keystore...${NC}"
      echo -e "${YELLOW}⚠ WARNING: default password in use (audioconverter123) — set KEYSTORE_PASSWORD/KEY_PASSWORD for real distribution.${NC}"
      keytool -genkeypair -v \
        -keystore "$KS_PATH" \
        -alias "$K_ALIAS" \
        -keyalg RSA \
        -keysize 2048 \
        -validity 10000 \
        -storepass "$KS_PASS" \
        -keypass "$K_PASS" \
        -dname "CN=Audio Converter, OU=App, O=AudioConverter, L=Local, C=IR"
    fi

    # Find the unsigned or raw release APK to sign
    UNSIGNED_APK=$(find "$ROOT/src-tauri/gen/android/app/build/outputs/apk" -type f -name "*unsigned.apk" 2>/dev/null | head -n 1)
    if [ -z "$UNSIGNED_APK" ]; then
      UNSIGNED_APK="$RAW_APK"
    fi

    OUT_APK="$(dirname "$UNSIGNED_APK")/AudioConverter-android-${TARGET_ARCH}.apk"
    echo "Signing APK: $UNSIGNED_APK -> $OUT_APK"

    "$APKSIGNER" sign \
      --ks "$KS_PATH" \
      --ks-key-alias "$K_ALIAS" \
      --ks-pass "pass:$KS_PASS" \
      --key-pass "pass:$K_PASS" \
      --v1-signing-enabled true \
      --v2-signing-enabled true \
      --v3-signing-enabled true \
      --out "$OUT_APK" \
      "$UNSIGNED_APK"

    echo "Verifying signed APK signature:"
    "$APKSIGNER" verify --verbose "$OUT_APK"

    if [ "$UNSIGNED_APK" != "$OUT_APK" ]; then
      rm -f "$UNSIGNED_APK"
    fi
    FINAL_APK="$OUT_APK"
    echo -e "${GREEN}✔ APK successfully signed.${NC}"
  fi
fi

# ------------------------------------------------------------------------------
# 8. Summary & Timing
# ------------------------------------------------------------------------------
END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))
FILE_SIZE=$(ls -lh "$FINAL_APK" | awk '{print $5}')
if command -v shasum >/dev/null 2>&1; then
  SHA256=$(shasum -a 256 "$FINAL_APK" | awk '{print $1}')
else
  SHA256=$(sha256sum "$FINAL_APK" | awk '{print $1}')
fi

echo -e "\n${GREEN}${BOLD}======================================================${NC}"
echo -e "${GREEN}${BOLD}🎉 Android Build Complete!${NC}"
echo -e "${GREEN}${BOLD}======================================================${NC}"
echo -e "  • ${BOLD}Output APK:${NC}  $FINAL_APK"
echo -e "  • ${BOLD}Size:${NC}        $FILE_SIZE"
echo -e "  • ${BOLD}SHA-256:${NC}     $SHA256"
echo -e "  • ${BOLD}Duration:${NC}    ${DURATION} seconds"
echo -e "${GREEN}${BOLD}======================================================${NC}\n"
