#!/usr/bin/env bash
# ==============================================================================
# Idempotent post-`tauri android init` project patcher.
#
# SINGLE source of truth for BOTH local builds (build-android-local.sh) and
# CI (.github/workflows/release.yml) so they can never drift apart:
#   1. Icons, strings.xml (+ Persian) incl. permission hint
#   2. extractNativeLibs (manifest) + useLegacyPackaging (gradle DSL, AGP 8)
#   3. Runtime media permissions injected into AndroidManifest.xml
#   4. Custom MainActivity.kt (JNI bridge, URI staging, permission prompts)
#   5. ffmpeg/ffprobe packaged as lib*.so into jniLibs/<abi>
#
# Usage: patch-android-project.sh <target-triple>
# ==============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GEN="$ROOT/src-tauri/gen/android"
TRIPLE="${1:-aarch64-linux-android}"

case "$TRIPLE" in
  aarch64-linux-android)   JNI_DIR="arm64-v8a" ;;
  armv7-linux-androideabi) JNI_DIR="armeabi-v7a" ;;
  x86_64-linux-android)    JNI_DIR="x86_64" ;;
  i686-linux-android)      JNI_DIR="x86" ;;
  *) echo "Unknown triple: $TRIPLE"; exit 1 ;;
esac

if [ ! -d "$GEN" ]; then
  echo "ERROR: $GEN missing — run 'pnpm tauri android init' first" >&2
  exit 1
fi

echo "Patching Tauri Android project ($TRIPLE → $JNI_DIR)..."

# --- 1. Icons + strings -------------------------------------------------------
if [ -d "$ROOT/src-tauri/icons/android" ]; then
  cp -rf "$ROOT/src-tauri/icons/android"/* "$GEN/app/src/main/res/" 2>/dev/null || true
fi
mkdir -p "$GEN/app/src/main/res/values" "$GEN/app/src/main/res/values-fa" "$GEN/app/src/main/res/drawable"
cat > "$GEN/app/src/main/res/values/strings.xml" << 'EOF'
<resources>
    <string name="app_name">Audio Converter</string>
    <string name="main_activity_title">Audio Converter</string>
    <string name="default_notification_channel_id">audio_converter_notifications</string>
    <string name="permission_denied_hint">Storage / media access is required to pick files. Grant it in system Settings → Apps → Audio Converter → Permissions.</string>
    <string name="media3_notification_channel_name">Music playback</string>
    <string name="media3_notification_channel_description">Shows the current track and playback controls</string>
    <string name="service_starting">Starting…</string>
</resources>
EOF
cat > "$GEN/app/src/main/res/drawable/ic_notification.xml" << 'EOF'
<?xml version="1.0" encoding="utf-8"?>
<!-- Minimal white music-note small icon for the Media3 playback notification.
     Must stay a white silhouette on transparent (notification requirement). -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24"
    android:tint="#FFFFFF">
    <path
        android:fillColor="#FFFFFF"
        android:pathData="M12,3v10.55c-0.59,-0.34 -1.27,-0.55 -2,-0.55 -2.21,0 -4,1.79 -4,4s1.79,4 4,4 4,-1.79 4,-4V7h4V3h-6z" />
</vector>
EOF
cat > "$GEN/app/src/main/res/values-fa/strings.xml" << 'EOF'
<resources>
    <string name="app_name">مبدل صوت</string>
    <string name="permission_denied_hint">برای انتخاب فایل، دسترسی حافظه لازم است. آن را در تنظیمات سیستم ← برنامه‌ها ← مبدل صوت ← دسترسی‌ها فعال کنید.</string>
</resources>
EOF

MANIFEST="$GEN/app/src/main/AndroidManifest.xml"
GRADLE_FILE="$GEN/app/build.gradle.kts"

# --- 2. Native libs must be EXTRACTED to nativeLibraryDir ---------------------
# Without this, ffmpeg/ffprobe never appear under nativeLibraryDir and every
# conversion fails with "bundled binary missing". AGP 8 prefers the gradle
# DSL, so patch both surfaces.
if [ -f "$MANIFEST" ] && ! grep -q 'android:extractNativeLibs="true"' "$MANIFEST"; then
  sed -i.bak 's/<application/<application android:extractNativeLibs="true"/' "$MANIFEST"
  rm -f "$MANIFEST.bak"
fi
if [ -f "$GRADLE_FILE" ] && ! grep -q "useLegacyPackaging" "$GRADLE_FILE"; then
  sed -i.bak 's/^android {/android {\n    packagingOptions {\n        jniLibs {\n            useLegacyPackaging = true\n        }\n    }/' "$GRADLE_FILE"
  rm -f "$GRADLE_FILE.bak"
fi

if [ -f "$GRADLE_FILE" ] && ! grep -q "media3-exoplayer" "$GRADLE_FILE"; then
  node -e '
    const fs = require("fs");
    const p = process.argv[1];
    let content = fs.readFileSync(p, "utf8");
    const media3Deps = "\n    // Media3 (ExoPlayer, MediaSession, UI)\n    val media3Version = \"1.5.1\"\n    implementation(\"androidx.media3:media3-exoplayer:$media3Version\")\n    implementation(\"androidx.media3:media3-session:$media3Version\")\n    implementation(\"androidx.media3:media3-ui:$media3Version\")\n";
    content = content.replace(/dependencies\s*\{/, "$&" + media3Deps);
    fs.writeFileSync(p, content);
  ' "$GRADLE_FILE"
fi

# --- 3. Runtime media permissions & PlaybackService (per-permission idempotent) ---
node -e '
  const fs = require("fs");
  const p = process.argv[1];
  let content = fs.readFileSync(p, "utf8");
  const need = [];
  const has = (perm) =>
    new RegExp(`<uses-permission[^>]*android:name="${perm.replace(/\\./g, "\\\\.")}"`).test(content);
  const add = (perm) => { if (!has(perm)) need.push(perm); };
  add("android.permission.READ_MEDIA_AUDIO");
  add("android.permission.READ_MEDIA_VIDEO");
  add("android.permission.READ_EXTERNAL_STORAGE");
  add("android.permission.WRITE_EXTERNAL_STORAGE");
  add("android.permission.INTERNET");
  add("android.permission.POST_NOTIFICATIONS");
  add("android.permission.FOREGROUND_SERVICE");
  add("android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK");
  add("android.permission.WAKE_LOCK");
  if (need.length > 0) {
    const perms =
      (need.includes("android.permission.READ_MEDIA_AUDIO") ? "\n    <uses-permission android:name=\"android.permission.READ_MEDIA_AUDIO\" />" : "") +
      (need.includes("android.permission.READ_MEDIA_VIDEO") ? "\n    <uses-permission android:name=\"android.permission.READ_MEDIA_VIDEO\" />" : "") +
      (need.includes("android.permission.READ_EXTERNAL_STORAGE") ? "\n    <uses-permission android:name=\"android.permission.READ_EXTERNAL_STORAGE\" android:maxSdkVersion=\"32\" />" : "") +
      (need.includes("android.permission.WRITE_EXTERNAL_STORAGE") ? "\n    <!-- MediaStore publishing of outputs on Android 9 and below -->\n    <uses-permission android:name=\"android.permission.WRITE_EXTERNAL_STORAGE\" android:maxSdkVersion=\"28\" />" : "") +
      (need.includes("android.permission.INTERNET") ? "\n    <uses-permission android:name=\"android.permission.INTERNET\" />" : "") +
      (need.includes("android.permission.POST_NOTIFICATIONS") ? "\n    <uses-permission android:name=\"android.permission.POST_NOTIFICATIONS\" />" : "") +
      (need.includes("android.permission.FOREGROUND_SERVICE") ? "\n    <uses-permission android:name=\"android.permission.FOREGROUND_SERVICE\" />" : "") +
      (need.includes("android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK") ? "\n    <uses-permission android:name=\"android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK\" />" : "") +
      (need.includes("android.permission.WAKE_LOCK") ? "\n    <uses-permission android:name=\"android.permission.WAKE_LOCK\" />" : "");

    content = content.replace(/<manifest[^>]*>/, (m) => m + perms);
  }

  // Inject PlaybackService into application tag if missing
  if (!content.includes("PlaybackService")) {
    const serviceTag = "\n        <!-- Media3 Foreground Playback Service -->\n        <service\n            android:name=\".PlaybackService\"\n            android:foregroundServiceType=\"mediaPlayback\"\n            android:exported=\"true\">\n            <intent-filter>\n                <action android:name=\"androidx.media3.session.MediaSessionService\" />\n                <action android:name=\"android.media.browse.MediaBrowserService\" />\n            </intent-filter>\n            <meta-data\n                android:name=\"androidx.media3.session.DefaultMediaNotificationProvider.smallIcon\"\n                android:resource=\"@drawable/ic_notification\" />\n        </service>\n";
    content = content.replace(/<\/application>/, serviceTag + "    $&");
  }

  // Ensure the Media3 smallIcon meta-data survives re-patches (older
  // manifests have the service without it, which falls back to the app icon
  // or no icon in the media notification).
  if (content.includes("PlaybackService") && !content.includes("DefaultMediaNotificationProvider.smallIcon")) {
    content = content.replace(
      /(<service[^>]*android:name="\.PlaybackService"[^>]*>[\s\S]*?<intent-filter>[\s\S]*?<\/intent-filter>)/,
      "$1\n            <meta-data\n                android:name=\"androidx.media3.session.DefaultMediaNotificationProvider.smallIcon\"\n                android:resource=\"@drawable/ic_notification\" />"
    );
  }

  fs.writeFileSync(p, content);
' "$MANIFEST"

# Intent filters: Open With (ACTION_VIEW) and Share Sheet (ACTION_SEND / ACTION_SEND_MULTIPLE)
if [ -f "$MANIFEST" ] && ! grep -q "android.intent.action.VIEW" "$MANIFEST"; then
  node -e '
    const fs = require("fs");
    const p = process.argv[1];
    let content = fs.readFileSync(p, "utf8");
    const intentFilters = "\n            <!-- Open With (ACTION_VIEW) for audio files -->" +
      "\n            <intent-filter>" +
      "\n                <action android:name=\"android.intent.action.VIEW\" />" +
      "\n                <category android:name=\"android.intent.category.DEFAULT\" />" +
      "\n                <data android:mimeType=\"audio/*\" />" +
      "\n                <data android:mimeType=\"application/ogg\" />" +
      "\n                <data android:mimeType=\"application/x-ogg\" />" +
      "\n                <data android:mimeType=\"application/flac\" />" +
      "\n                <data android:mimeType=\"application/x-flac\" />" +
      "\n            </intent-filter>" +
      "\n            <intent-filter>" +
      "\n                <action android:name=\"android.intent.action.VIEW\" />" +
      "\n                <category android:name=\"android.intent.category.DEFAULT\" />" +
      "\n                <data android:scheme=\"content\" />" +
      "\n                <data android:mimeType=\"audio/*\" />" +
      "\n            </intent-filter>" +
      "\n            <intent-filter>" +
      "\n                <action android:name=\"android.intent.action.VIEW\" />" +
      "\n                <category android:name=\"android.intent.category.DEFAULT\" />" +
      "\n                <data android:scheme=\"file\" />" +
      "\n                <data android:mimeType=\"audio/*\" />" +
      "\n            </intent-filter>";
    content = content.replace(/<\/activity>/, intentFilters + "\n        $&");
    fs.writeFileSync(p, content);
  ' "$MANIFEST"
fi

if [ -f "$MANIFEST" ] && ! grep -q "android.intent.action.SEND" "$MANIFEST"; then
  node -e '
    const fs = require("fs");
    const p = process.argv[1];
    let content = fs.readFileSync(p, "utf8");
    const shareFilter = "\n            <!-- Share Sheet integration for audio and video files -->" +
      "\n            <intent-filter>" +
      "\n                <action android:name=\"android.intent.action.SEND\" />" +
      "\n                <category android:name=\"android.intent.category.DEFAULT\" />" +
      "\n                <data android:mimeType=\"audio/*\" />" +
      "\n                <data android:mimeType=\"video/*\" />" +
      "\n            </intent-filter>" +
      "\n            <intent-filter>" +
      "\n                <action android:name=\"android.intent.action.SEND_MULTIPLE\" />" +
      "\n                <category android:name=\"android.intent.category.DEFAULT\" />" +
      "\n                <data android:mimeType=\"audio/*\" />" +
      "\n                <data android:mimeType=\"video/*\" />" +
      "\n            </intent-filter>";
    content = content.replace(/<\/activity>/, shareFilter + "\n        $&");
    fs.writeFileSync(p, content);
  ' "$MANIFEST"
fi

# --- 4. Custom Kotlin sources & ProGuard rules (JNI bridge preservation) ------
mkdir -p "$GEN/app/src/main/java/com/audioconverter/app"
if [ -d "$ROOT/src-tauri/android" ]; then
  cp -rf "$ROOT/src-tauri/android"/*.kt "$GEN/app/src/main/java/com/audioconverter/app/" 2>/dev/null || true
fi

cat > "$GEN/app/proguard-rules.pro" << 'EOF'
-keep class com.audioconverter.app.MainActivity {
    public static <methods>;
    public <methods>;
    *;
}
-keep class com.audioconverter.app.MainActivity$Companion {
    public <methods>;
    *;
}
-keep class com.audioconverter.app.PlaybackService {
    public <methods>;
    *;
}
-keepclassmembers class com.audioconverter.app.MainActivity {
    public static <methods>;
    *;
}
-keepclassmembers class com.audioconverter.app.MainActivity$Companion {
    public <methods>;
    *;
}
-keepclassmembers class com.audioconverter.app.PlaybackService {
    public <methods>;
    *;
}
-keepclasseswithmembers class * {
    native <methods>;
}
EOF

# --- 5. ffmpeg/ffprobe as lib*.so into jniLibs ---------------------------------
FFMPEG_BIN="$ROOT/src-tauri/binaries/ffmpeg-$TRIPLE"
FFPROBE_BIN="$ROOT/src-tauri/binaries/ffprobe-$TRIPLE"
if [ ! -f "$FFMPEG_BIN" ] || [ ! -f "$FFPROBE_BIN" ]; then
  echo "ERROR: Android ffmpeg/ffprobe binaries missing ($FFMPEG_BIN, $FFPROBE_BIN)." >&2
  echo "       Run: TARGET_TRIPLE=$TRIPLE pnpm fetch:ffmpeg" >&2
  exit 1
fi
JNILIBS_TARGET="$GEN/app/src/main/jniLibs/$JNI_DIR"
mkdir -p "$JNILIBS_TARGET"
cp -f "$FFMPEG_BIN" "$JNILIBS_TARGET/libffmpeg.so"
cp -f "$FFPROBE_BIN" "$JNILIBS_TARGET/libffprobe.so"
chmod 755 "$JNILIBS_TARGET"/lib*.so

echo "Patched: strings, extractNativeLibs/useLegacyPackaging, media permissions, MainActivity.kt, jniLibs/$JNI_DIR"
