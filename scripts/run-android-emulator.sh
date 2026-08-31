#!/usr/bin/env bash
# ==============================================================================
# Android Emulator Runner & APK Installer for Audio Converter (macOS & Linux)
# Boots the ARM64 AVD, waits for boot, builds (if needed), installs & launches app.
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

# ------------------------------------------------------------------------------
# 0. Setup Environment
# ------------------------------------------------------------------------------
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/emulator:$ANDROID_HOME/platform-tools:$PATH"

EMULATOR_BIN="$ANDROID_HOME/emulator/emulator"
ADB_BIN="$ANDROID_HOME/platform-tools/adb"

if [ ! -x "$EMULATOR_BIN" ]; then
  echo -e "${RED}✘ Emulator binary not found at $EMULATOR_BIN${NC}"
  exit 1
fi

if [ ! -x "$ADB_BIN" ]; then
  echo -e "${RED}✘ adb binary not found at $ADB_BIN${NC}"
  exit 1
fi

# ------------------------------------------------------------------------------
# 1. Parse Arguments
# ------------------------------------------------------------------------------
AVD_NAME="Pixel_6_API_34"
REBUILD=0
HEADLESS=0
SAMPLE_FILE=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --rebuild|-b)
      REBUILD=1
      shift
      ;;
    --headless|-h)
      HEADLESS=1
      shift
      ;;
    --avd)
      AVD_NAME="$2"
      shift 2
      ;;
    --push-sample|-p)
      SAMPLE_FILE="$2"
      shift 2
      ;;
    --help)
      echo "Usage: ./scripts/run-android-emulator.sh [options]"
      echo ""
      echo "Options:"
      echo "  --rebuild, -b          Force build fresh APK before installing"
      echo "  --headless, -h         Start emulator without GUI window"
      echo "  --avd <name>           Specify AVD name (default: Pixel_6_API_34)"
      echo "  --push-sample <file>   Push sample audio/video file to emulator Downloads"
      echo "  --help                 Show this help message"
      exit 0
      ;;
    *)
      echo -e "${RED}Unknown argument: $1${NC}"
      exit 1
      ;;
  esac
done

echo -e "${CYAN}${BOLD}=== Audio Converter: Android Emulator Runner ===${NC}\n"

# Verify AVD existence
INSTALLED_AVDS="$("$EMULATOR_BIN" -list-avds 2>/dev/null || true)"
if ! echo "$INSTALLED_AVDS" | grep -q "^${AVD_NAME}$"; then
  FIRST_AVD="$(echo "$INSTALLED_AVDS" | head -n 1)"
  if [ -n "$FIRST_AVD" ]; then
    echo -e "${YELLOW}⚠ AVD '$AVD_NAME' not found. Using '$FIRST_AVD' instead.${NC}"
    AVD_NAME="$FIRST_AVD"
  else
    echo -e "${RED}✘ No Android Virtual Device (AVD) found!${NC}"
    exit 1
  fi
fi

# ------------------------------------------------------------------------------
# 2. Check or Launch Emulator
# ------------------------------------------------------------------------------
RUNNING_EMULATOR="$("$ADB_BIN" devices 2>/dev/null | grep -E "emulator-[0-9]+" | awk '{print $1}' | head -n 1 || true)"

if [ -n "$RUNNING_EMULATOR" ]; then
  echo -e "${GREEN}✔ Emulator already running:${NC} $RUNNING_EMULATOR"
else
  echo -e "${BLUE}▶ Starting Android Emulator ($AVD_NAME)...${NC}"
  EMULATOR_FLAGS=("-avd" "$AVD_NAME" "-netdelay" "none" "-netspeed" "full")
  if [ $HEADLESS -eq 1 ]; then
    EMULATOR_FLAGS+=("-no-window" "-no-audio")
  fi

  "$EMULATOR_BIN" "${EMULATOR_FLAGS[@]}" > /dev/null 2>&1 &
  EMULATOR_PID=$!
  echo -e "  Started emulator background process (PID: $EMULATOR_PID)"
fi

# ------------------------------------------------------------------------------
# 3. Wait for Device & Boot Completion
# ------------------------------------------------------------------------------
echo -e "${BLUE}▶ Waiting for emulator to boot up...${NC}"
"$ADB_BIN" wait-for-device

BOOT_COMPLETED=0
RETRIES=0
MAX_RETRIES=60

while [ $RETRIES -lt $MAX_RETRIES ]; do
  STATUS="$("$ADB_BIN" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r' || true)"
  if [ "$STATUS" = "1" ]; then
    BOOT_COMPLETED=1
    break
  fi
  printf "."
  sleep 2
  RETRIES=$((RETRIES + 1))
done
echo ""

if [ $BOOT_COMPLETED -eq 0 ]; then
  echo -e "${RED}✘ Timed out waiting for Android emulator to finish booting.${NC}"
  exit 1
fi
echo -e "${GREEN}✔ Emulator booted successfully!${NC}"

# ------------------------------------------------------------------------------
# 4. Build APK (if requested or missing)
# ------------------------------------------------------------------------------
APK_FILE="$ROOT/src-tauri/gen/android/app/build/outputs/apk/universal/release/AudioConverter-android-aarch64.apk"

if [ $REBUILD -eq 1 ] || [ ! -f "$APK_FILE" ]; then
  echo -e "\n${BLUE}▶ Building APK...${NC}"
  bash "$ROOT/scripts/build-android-local.sh"
fi

if [ ! -f "$APK_FILE" ]; then
  # Fallback to any APK produced
  APK_FILE="$(find "$ROOT/src-tauri/gen/android/app/build/outputs/apk" -name "*.apk" 2>/dev/null | sort | tail -n 1)"
fi

if [ -z "$APK_FILE" ] || [ ! -f "$APK_FILE" ]; then
  echo -e "${RED}✘ Could not find APK to install!${NC}"
  exit 1
fi

# ------------------------------------------------------------------------------
# 5. Install APK
# ------------------------------------------------------------------------------
echo -e "\n${BLUE}▶ Installing APK to emulator ($("$ADB_BIN" get-serialno))...${NC}"
"$ADB_BIN" install -r -d "$APK_FILE"
echo -e "${GREEN}✔ App installed successfully.${NC}"

# ------------------------------------------------------------------------------
# 6. Push Sample Media (Optional)
# ------------------------------------------------------------------------------
if [ -n "$SAMPLE_FILE" ] && [ -f "$SAMPLE_FILE" ]; then
  SAMPLE_BASE="$(basename "$SAMPLE_FILE")"
  echo -e "\n${BLUE}▶ Pushing sample file $SAMPLE_BASE to /sdcard/Download/...${NC}"
  "$ADB_BIN" push "$SAMPLE_FILE" "/sdcard/Download/$SAMPLE_BASE"
  # Refresh Android MediaScanner so file appears in file pickers
  "$ADB_BIN" shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d "file:///sdcard/Download/$SAMPLE_BASE" >/dev/null 2>&1 || true
  echo -e "${GREEN}✔ Sample file pushed to /sdcard/Download/$SAMPLE_BASE${NC}"
fi

# ------------------------------------------------------------------------------
# 7. Launch App on Emulator
# ------------------------------------------------------------------------------
echo -e "\n${BLUE}▶ Launching Audio Converter on emulator...${NC}"
# Use monkey launcher or direct intent
"$ADB_BIN" shell monkey -p com.audioconverter.app -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 || \
"$ADB_BIN" shell am start -n com.audioconverter.app/com.audioconverter.app.MainActivity >/dev/null 2>&1 || true

echo -e "\n${GREEN}${BOLD}======================================================${NC}"
echo -e "${GREEN}${BOLD}🚀 Audio Converter is now running on Android Emulator!${NC}"
echo -e "${GREEN}${BOLD}======================================================${NC}"
echo -e "  • ${BOLD}AVD:${NC}          $AVD_NAME"
echo -e "  • ${BOLD}Installed APK:${NC} $(basename "$APK_FILE")"
echo -e "  • ${BOLD}Media Dir:${NC}    /sdcard/Download/"
echo -e "\n${CYAN}💡 Tips:${NC}"
echo -e "  - Drag & drop audio/video files directly into the emulator window to test."
echo -e "  - Or push via CLI: ${YELLOW}adb push my_video.mp4 /sdcard/Download/${NC}"
echo -e "  - View live app logs: ${YELLOW}adb logcat -s AudioConverter:* tauri:* Rust:*${NC}"
echo -e "${GREEN}${BOLD}======================================================${NC}\n"
