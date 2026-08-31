#!/usr/bin/env bash
# ==============================================================================
# Fast Android Live-Reload (Hot Module Replacement) Runner for Audio Converter
# Starts emulator if needed, connects Vite HMR, and enables instant live updates.
# ==============================================================================
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Setup Environment
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export ANDROID_NDK_HOME="$(find -L "$ANDROID_HOME/ndk" -maxdepth 1 -mindepth 1 2>/dev/null | sort -V | tail -n 1)"
export NDK_HOME="$ANDROID_NDK_HOME"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/emulator:$ANDROID_HOME/platform-tools:$PATH"

EMULATOR_BIN="$ANDROID_HOME/emulator/emulator"
ADB_BIN="$ANDROID_HOME/platform-tools/adb"
AVD_NAME="Pixel_6_API_34"

echo -e "${CYAN}${BOLD}=== Audio Converter: Android Live-Reload Dev Mode ===${NC}\n"

# 1. Check or start emulator
RUNNING_EMULATOR="$("$ADB_BIN" devices 2>/dev/null | grep -E "emulator-[0-9]+" | awk '{print $1}' | head -n 1 || true)"

if [ -z "$RUNNING_EMULATOR" ]; then
  echo -e "${BLUE}▶ Starting Android Emulator ($AVD_NAME)...${NC}"
  "$EMULATOR_BIN" -avd "$AVD_NAME" -netdelay none -netspeed full > /dev/null 2>&1 &
  echo -e "${BLUE}▶ Waiting for emulator to boot...${NC}"
  "$ADB_BIN" wait-for-device
  while [ "$("$ADB_BIN" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r' || true)" != "1" ]; do
    sleep 1
  done
  echo -e "${GREEN}✔ Emulator is ready.${NC}"
else
  echo -e "${GREEN}✔ Emulator is already running ($RUNNING_EMULATOR).${NC}"
fi

# 2. Ensure Android project is initialized and patched
if [ ! -d "$ROOT/src-tauri/gen/android" ]; then
  echo -e "${YELLOW}Initializing Android project...${NC}"
  pnpm tauri android init
fi

bash "$ROOT/scripts/patch-android-project.sh" aarch64-linux-android

# Ensure no signature conflict with previous release builds
"$ADB_BIN" uninstall com.audioconverter.app >/dev/null 2>&1 || true

# 3. Start Tauri Android Dev Mode (with Hot Module Replacement)
echo -e "${GREEN}${BOLD}⚡ Starting Live-Reload Dev Server...${NC}"
echo -e "${CYAN}Any changes in React/TypeScript/CSS will update instantly on the emulator!${NC}\n"

pnpm tauri android dev "$@"
