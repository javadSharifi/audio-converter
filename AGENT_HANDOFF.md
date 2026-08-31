# 🤖 Agent Handoff & Codebase Architecture Guide
> **Project:** Audio Converter (Desktop & Mobile Video/Audio to Audio Transcoder)  
> **Version:** 1.2.12  
> **Target Audience:** AI Agents, LLM Coding Assistants, Human Maintainers  
> **Stack:** Tauri v2 + React 19 + TypeScript + Zustand 5 + Tailwind CSS v4 + Rust (2021) + Bundled FFmpeg 8.1.2 (LGPL)  
> **Supported Targets:** macOS (`aarch64`/`x86_64`), Windows (`x86_64`), Linux (`x86_64`), Android (`aarch64` / arm64-v8a)

---

## 📌 1. Project Overview & Architecture

### 1.1 Core Mission
**Audio Converter** is a cross-platform desktop and mobile application designed to convert video and audio files into optimized audio formats (`MP3`, `WAV`, `AAC`, `M4A`, `FLAC`, `Opus`). It operates with **zero external runtime dependencies** for end users by bundling platform-specific, statically compiled **LGPL FFmpeg 8.1.2** binaries.

### 1.2 Key Capabilities
- **Probing & Ingestion:** Probes files via `ffprobe` (JSON output) rather than relying on file extensions.
- **Waveform Extraction & Trimming:** Decodes audio stream to 16 kHz mono raw PCM via `ffmpeg` to extract waveform min/max peaks for an interactive HTML5 Canvas editor with audio auditioning (`asset://` protocol).
- **Silence Removal:** Performs two-pass processing: initial detection via `silencedetect` filter, followed by deterministic segment slicing and concatenation (`atrim` + `concat`).
- **Fixed-Duration Splitting:** Splits long media into parts (e.g. 60 min) with remainders mapped to the final part. Critically, splitting is computed against the **post-silence timeline**.
- **Single-Pass Filter Complex:** Extraction, trimming, silence removal, and encoding occur in single FFmpeg invocations per part without intermediate lossy re-encodings.
- **Queue & Worker Management:** Multi-threaded worker queue with concurrency limits, real-time progress parsing (`-progress pipe:1`), cancellation with child process termination, and temporary `.part` file cleanup.
- **Disk Space Pre-flight:** Queries target drive free space (`statvfs` on Unix, `GetDiskFreeSpaceExW` on Windows) before encoding.
- **Android Platform Integration:** Native Kotlin Activity bridge (`MainActivity.kt`) and Rust JNI (`android_fs.rs`) handling Scoped Storage `content://` URI staging, `MediaStore.Audio` output publishing (`Music/AudioConverter`), and runtime permission requests.
- **Internationalization (i18n) & UI:** Full English and Persian (Farsi) support with automated RTL/LTR layout flipping, and Light/Dark/System theme switching. Clean, high-contrast, minimalist UI design.

---

## 🏛️ 2. Architectural Blueprint & Data Flow

```mermaid
graph TD
    subgraph Frontend ["Frontend (React 19 + TypeScript + Zustand)"]
        UI[User Interface / DropZone / FileList / OptionsPanel]
        Store[Zustand Store (useAppStore.ts)]
        Trim[TrimEditor (Canvas Waveform & Audio Preview)]
        TauriClient[Tauri Client API (src/utils/tauri.ts)]
    end

    subgraph IPC ["Tauri v2 IPC Layer"]
        Commands[Tauri Commands (src-tauri/src/commands/mod.rs)]
        Events[Event Emitter: job-event, queue-idle]
    end

    subgraph Backend ["Backend (Rust Engine)"]
        QM[QueueManager (src-tauri/src/queue/mod.rs)]
        Pipeline[Processing Pipeline (src-tauri/src/processing/pipeline.rs)]
        Silence[Silence Analysis (src-tauri/src/processing/silence.rs)]
        Split[Split Math (src-tauri/src/processing/split.rs)]
        Naming[Naming & Collision Guard (src-tauri/src/processing/naming.rs)]
        Probe[FFprobe Module (src-tauri/src/ffmpeg/probe.rs)]
        Waveform[Waveform Generator (src-tauri/src/ffmpeg/waveform.rs)]
        FFmpegRunner[FFmpeg Process Runner (src-tauri/src/ffmpeg/run.rs)]
        Disk[Disk Space Guard (src-tauri/src/disk.rs)]
        Settings[Settings Engine (src-tauri/src/settings.rs)]
    end

    subgraph Binaries ["Bundled Binaries"]
        FFmpegBin[ffmpeg executable]
        FFprobeBin[ffprobe executable]
    end

    UI --> Store
    Trim --> TauriClient
    Store --> TauriClient
    TauriClient -->|Invoke| Commands
    Commands --> QM
    Commands --> Probe
    Commands --> Waveform
    Commands --> Disk
    Commands --> Settings
    QM --> Pipeline
    Pipeline --> Silence
    Pipeline --> Split
    Pipeline --> Naming
    Pipeline --> Disk
    Pipeline --> FFmpegRunner
    Waveform --> FFmpegRunner
    Probe --> FFprobeBin
    FFmpegRunner --> FFmpegBin
    QM -->|Emit Events| Events
    Events -->|Listen| Store
```

---

## 📂 3. Complete File-by-File Catalog

Below is the exhaustive catalog of every file in the repository, explaining its purpose, responsibilities, key functions/types, and inter-file dependencies.

### 根 Root Files & Configuration

| File | Type | Purpose & Details |
| :--- | :--- | :--- |
| `package.json` | Configuration | Defines frontend dependencies (`react@19`, `zustand@5`, `@tauri-apps/api@2`, `@tailwindcss/vite@4`), dev tools (`vitest`, `typescript`), and execution scripts (`dev`, `build`, `tauri`, `fetch:ffmpeg`, `test`, `test:rust`). |
| `tsconfig.json` | Configuration | TypeScript compiler settings (target `ES2022`, module resolution `bundler`, strict mode enabled, JSX `react-jsx`). |
| `vite.config.ts` | Configuration | Vite 7 configuration with `@vitejs/plugin-react` and `@tailwindcss/vite`. Configures local dev server on port 1420 and ignores `src-tauri` during watch. |
| `index.html` | Entry HTML | Host HTML document loading `/src/main.tsx`. Sets viewport and default meta tags. |
| `README.md` | Documentation | High-level user & developer documentation, build instructions, test run commands, and LGPL licensing notes. |
| `pnpm-lock.yaml` | Lockfile | Pnpm deterministic dependency graph lockfile. |

---

### 🎨 Frontend Source (`src/`)

#### Application Entry & Shell

| File | Purpose & Details |
| :--- | :--- |
| `src/main.tsx` | **React DOM Root Mount:** Initializes React 19 root on `#root`, mounting `<App />` within `React.StrictMode`. |
| `src/App.tsx` | **Main UI Layout & Orchestration:** Composes `HeaderBar`, `DropZone`, `FileList`, `OptionsPanel`, `JobsPanel`, `StartBar`, and `Toasts`. Initializes global native drag-drop listener (`useNativeDragDrop`), event listeners, and auto-open output directory handler upon queue completion. |
| `src/index.css` | **Global Styles:** Imports `@import "tailwindcss";` for Tailwind CSS v4 styling rules. |

#### Types & State (`src/types/`, `src/stores/`)

| File | Purpose & Details |
| :--- | :--- |
| `src/types/index.ts` | **TypeScript Type Definitions:** Mirrors Rust IPC data models. Defines `AudioFormat`, `QualityPreset`, `OutputMode`, `ConversionOptions`, `InputFile`, `TrimSpec`, `FileMeta`, `QueueItem`, `JobStatus`, `AppSettings`, bitrate constants (`MP3_BITRATES`, `AAC_OPUS_BITRATES`), and helper `isLossy()`. |
| `src/types/generated.ts` | **Specta Auto-Generated TypeScript Bindings:** Auto-exported from Rust backend structs and enums via `pnpm generate:types`. |
| `src/stores/useAppStore.ts` | **Zustand Root Store:** Composition of all domain slices into a unified hook `useAppStore`. |
| `src/stores/slices/fileSlice.ts` | **File Ingestion Slice:** Handles file picking, probing via `api.probeFiles`, Android `content://` statting via `api.statMediaPaths`, trim updates, and file removals. |
| `src/stores/slices/jobSlice.ts` | **Job Queue Slice:** Coordinates conversion queue startup, real-time `job-event` listeners, cancellations, speed/progress updates, and queue clearance. |
| `src/stores/slices/settingsSlice.ts` | **Settings Slice:** Manages app settings loading/saving (`api.getSettings`, `api.saveSettings`), concurrency configuration, language selection, and theme state. |
| `src/stores/slices/uiSlice.ts` | **UI & Toast Slice:** Non-blocking notification banner management (`pushToast`, `dismissToast`). |

#### UI Components (`src/components/`)

| File | Purpose & Details |
| :--- | :--- |
| `src/components/HeaderBar.tsx` | **Header & Global Controls:** Displays app title, version (via `@tauri-apps/api/app`), language selector (`en`/`fa`), theme toggle (`light`/`dark`/`system`), and settings modal (concurrency slider & auto-open toggle). Clean solid aesthetic. |
| `src/components/DropZone.tsx` | **Initial Drag-and-Drop Area:** Rendered when no files are loaded. Triggers native OS file picker (`pickVideos`) or accepts file drops. Pulsing animation during probing. |
| `src/components/FileList.tsx` | **Loaded Files Table:** Displays queued source files with columns for Name, Size, Duration, Format, and Trim Range. Contains row deletion buttons, clear list button, "Add more" picker, and toggle button (✂) to expand/collapse `TrimEditor`. |
| `src/components/TrimEditor.tsx` | **Interactive Audio Waveform & Trimmer:** Canvas-based interactive waveform visualizer. Decodes audio peaks via `waveformPeaks()` IPC and auditions audio snippets via `<audio>` and `fileToAssetUrl()`. Provides draggable handles, manual timecode inputs (`0:00.0`), selection playback, and quick-cut presets (Cut first/last 10s). |
| `src/components/OptionsPanel.tsx` | **Output Options Configuration:** Format picker (`mp3`, `aac`, `m4a`, `opus`, `wav`, `flac`) with dynamic estimated file size badges; Quality presets (Low, Medium, High, Very High, Custom bitrate); Split toggle & duration input (minutes or clock format); Silence removal toggle; Output folder mode (`same_as_source`, `custom_folder`, `per_source_folder`, disabled on Android with MediaStore note); Advanced settings (Sample rate, Mono/Stereo, Silence threshold dB, Silence min duration). |
| `src/components/JobsPanel.tsx` | **Conversion Queue & Progress Panel:** Displays list of converting/queued/finished jobs with animated status indicators, individual progress bars, speed metrics (e.g. `12.3x`), overall batch progress bar, error messages with expandable "Technical Details" (raw stderr), and Cancel / Clear buttons. |
| `src/components/Toasts.tsx` | **Toast Notification Stack:** Displays non-blocking notification banners at the bottom of the screen with auto-dismiss (6 seconds). |
| `src/components/__tests__/FileList.test.tsx` | **Frontend Unit Tests:** Vitest test suite testing file row rendering, trim toggle expansion, and file removal behavior. |

#### Hooks & Utilities (`src/hooks/`, `src/utils/`, `src/i18n/`)

| File | Purpose & Details |
| :--- | :--- |
| `src/hooks/useNativeDragDrop.ts` | **Tauri Webview Drag-and-Drop Hook:** Subscribes to native window drag/drop events via `@tauri-apps/api/webview` (`onDragDropEvent`) to receive raw absolute file paths from the OS. |
| `src/hooks/useTheme.ts` | **Theme & Direction Hooks:** `useTheme()` synchronizes `class="dark"` on `<html>` and watches system color scheme media query. `useDirection()` toggles `dir="rtl"` for Persian (`fa`) and `dir="ltr"` for English (`en`). |
| `src/utils/platform.ts` | **Platform Detection:** Provides `isAndroid()`, `isMobile()`, `isDesktop()` detection helpers. |
| `src/utils/tauri.ts` | **IPC Client Wrapper:** Typed asynchronous wrappers for all backend Tauri commands: `probeFiles`, `statMediaPaths`, `resolveMediaPaths`, `hasMediaPermissions`, `requestMediaPermissions`, `openAppSettings`, `startConversion`, `waveformPeaks`, `fileToAssetUrl`, `cancelJob`, `cancelAll`, `clearFinished`, `getQueue`, `getSettings`, `saveSettings`, and `diskFree`. |
| `src/utils/dialog.ts` | **Native Dialog Wrapper:** Invokes Tauri file dialog with extensive media extensions filter (`mp4`, `mkv`, `avi`, `mov`, `webm`, `mp3`, `wav`, `flac`, `opus`, etc.). Includes `isAudioPath()` helper. |
| `src/utils/estimate.ts` | **Output Size Estimator:** Calculates predicted output file size based on duration, trim windows, and target format bitrate. Supplies percentage delta comparison against input file size (`growthHint`). |
| `src/utils/estimate.test.ts` | **Estimation Tests:** Unit tests for bitrate estimation calculations across lossy and lossless formats. |
| `src/utils/format.ts` | **Formatting Helpers:** `formatDuration` (`H:MM:SS`), `formatTimecode` (`M:SS.t`), `formatBytes` (`KB`/`MB`/`GB`), `parseDurationInput` (split duration in min or `HH:MM:SS`), and `parseTimeInput` (trim seconds). |
| `src/utils/format.test.ts` | **Format Tests:** Unit tests for duration, timecode, and byte formatting functions. |
| `src/i18n/index.ts` | **i18n Hub:** Translation engine function `translate(lang, key, params)` and `isRtl(lang)`. |
| `src/i18n/en.ts` | **English Dictionary:** Complete English translations map. |
| `src/i18n/fa.ts` | **Persian Dictionary:** Complete Persian (Farsi) translations map. |

---

### 🦀 Rust Backend Source (`src-tauri/`)

#### Configuration & Android Native Layer

| File | Purpose & Details |
| :--- | :--- |
| `src-tauri/Cargo.toml` | **Rust Package Manifest:** Defines dependencies (`tauri 2`, `serde`, `serde_json`, `jni`, `libc` on Unix, `windows-sys` on Windows) and release profile optimizations (LTO, strip, codegen-units = 1). |
| `src-tauri/build.rs` | **Cargo Build Script:** Executes `tauri_build::build()`. |
| `src-tauri/tauri.conf.json` | **Tauri Application Config:** Window dimensions (1100x760), CSP settings, `assetProtocol` scoping, bundle metadata, and `externalBin` registration for `binaries/ffmpeg` and `binaries/ffprobe`. |
| `src-tauri/capabilities/default.json` | **Tauri 2 ACL Permissions:** Grants permissions for core commands, events, native dialogs, and opener plugin. |
| `src-tauri/android/MainActivity.kt` | **Android Custom Activity & JNI Bridge:** Subclasses `TauriActivity`. Decorated with `@Keep` for ProGuard preservation. Houses JNI methods: `initNativePaths`, `statUri`, `resolveUriToLocalPath`, `publishOutputs`, `hasMediaPermissions`, `requestMediaPermissions`, `openAppSettings`. Uses Activity `ContentResolver` to respect temporary grants and Scoped Storage, publishing outputs to `MediaStore.Audio` under `Music/AudioConverter`. |
| `src-tauri/src/android_fs.rs` | **Rust-Android JNI Bridge:** Caches `JavaVM` and `MainActivity` class references in `JNI_OnLoad`. Implements `stage_uri_via_jni`, `publish_outputs_via_jni`, `call_static_string`, and `output_root` cache directory resolution. Clears and prints Java exceptions safely across JNI boundaries. |

#### Rust Core Modules (`src-tauri/src/`)

| File | Purpose & Details |
| :--- | :--- |
| `src-tauri/src/main.rs` | **Binary Entry Point:** Sets `#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]` to suppress Windows terminal console window, calling `audio_converter::run()`. |
| `src-tauri/src/lib.rs` | **Library Root & App Setup:** Initializes Tauri builder, registers `tauri_plugin_dialog` and `tauri_plugin_opener`, resolves and initializes app data directory (`settings::init_app_data_dir`), creates and manages `QueueManager` state, registers Tauri IPC command handlers, exports JNI hooks for Android, and binds process exit cleanup. |
| `src-tauri/src/types.rs` | **Data Types & Enums:** Core Rust types shared across backend and IPC: `AudioFormat`, `QualityPreset`, `OutputMode`, `TrimSpec` (with validation and `-to` timestamp rebasing), `ConversionOptions`, `JobStatus`, `FileMeta`, and `JobEvent`. |
| `src-tauri/src/error.rs` | **Error Handling (`AppError`):** Centralized error enum: `Io`, `FFmpeg`, `NoAudioTrack`, `CorruptedFile`, `InsufficientDiskSpace`, `InvalidInput`, `Cancelled`, `NotFound`, `Other`. Implements custom serialization for frontend consumption. |
| `src-tauri/src/disk.rs` | **Disk Space & Estimation:** Low-level OS free disk space detection (`libc::statvfs` on Unix, `GetDiskFreeSpaceExW` on Windows) and output size estimation (`estimate_output_bytes`). |
| `src-tauri/src/logger.rs` | **Logging Engine:** Custom logger formatting timestamps and writing logs to `<app_data>/logs/app.log` and stderr. Provides macros `log_info!`, `log_warn!`, `log_error!`. |
| `src-tauri/src/settings.rs` | **Persistent App Settings:** Loads, validates, clamps, and saves user configuration to `<app_data>/settings.json`. Includes default values and concurrency clamping (`max_reasonable_concurrency()`). |

#### Commands & IPC (`src-tauri/src/commands/`)

| File | Purpose & Details |
| :--- | :--- |
| `src-tauri/src/commands/mod.rs` | **Tauri Command Handlers:** Exposes callable IPC endpoints: `probe_files`, `stat_media_paths`, `resolve_media_paths`, `has_media_permissions`, `request_media_permissions`, `open_app_settings`, `waveform_peaks`, `start_conversion`, `cancel_job`, `cancel_all_jobs`, `clear_finished`, `get_queue`, `disk_free`, `get_settings`, `save_settings`. Enforces batch duplicate checks and validation before execution. |

#### FFmpeg Subsystem (`src-tauri/src/ffmpeg/`)

| File | Purpose & Details |
| :--- | :--- |
| `src-tauri/src/ffmpeg/mod.rs` | **Module Exports:** Exports `locate`, `probe`, `progress`, `run`, `waveform`. |
| `src-tauri/src/ffmpeg/locate.rs` | **Binary Locator:** Discovers bundled `ffmpeg` and `ffprobe` binaries. Resolution order: `TAURI_ANDROID_NATIVE_LIB_DIR` (`libffmpeg.so`) $\rightarrow$ `FFMPEG_PATH`/`FFPROBE_PATH` env vars $\rightarrow$ next to running executable $\rightarrow$ Cargo manifest dev directory. |
| `src-tauri/src/ffmpeg/probe.rs` | **Media Probing:** Runs `ffprobe -print_format json -show_format -show_streams` with structured args. Parses JSON to verify stream presence, audio codec, sample rate, channels, and duration. Rejects video-only files with `NoAudioTrack`. |
| `src-tauri/src/ffmpeg/progress.rs` | **FFmpeg Progress Parser:** Parses structured key-value lines emitted by FFmpeg `-progress pipe:1` (`out_time_us`, `speed`, `fps`, `total_size`, `progress=end`) avoiding fragile regex on human stderr. |
| `src-tauri/src/ffmpeg/run.rs` | **Process Execution & Cancellation Engine:** Spawns child processes (`Command`) with piped stdout/stderr. Features thread-safe `CancelToken` to kill child processes immediately upon cancellation. Runs concurrent stdout/stderr pump threads to prevent pipe deadlock, capturing the last 80 stderr lines for technical error reporting. |
| `src-tauri/src/ffmpeg/waveform.rs` | **Waveform Peak Extractor:** Decodes first audio stream to mono 16 kHz 16-bit PCM (`-ac 1 -ar 16000 -f s16le pipe:1`) up to 5 minutes, bucketizing raw samples into $N$ min/max pairs $[-1.0, 1.0]$ for frontend waveform rendering. |

#### Processing Pipeline (`src-tauri/src/processing/`)

| File | Purpose & Details |
| :--- | :--- |
| `src-tauri/src/processing/mod.rs` | **Module Exports:** Exports `naming`, `pipeline`, `silence`, `split`. |
| `src-tauri/src/processing/naming.rs` | **Output Paths & Sanitization:** Unicode-preserving filename sanitizer (`sanitize_component`), non-overwriting collision avoidance resolver (`unique_path` appending `(1)`, `(2)`), and destination directory resolver (`output_directory`, `build_output_paths`). On Android, routes outputs to internal app cache and triggers MediaStore publishing. |
| `src-tauri/src/processing/silence.rs` | **Silence Analysis:** Parses `silencedetect` output into `(start, end)` silence ranges, computes the kept audio complement ranges (`kept_ranges`), merges micro-gaps, and calculates total post-silence duration. |
| `src-tauri/src/processing/split.rs` | **Split Math & Time Translation:** Computes part slice windows (`split_windows`), translates post-silence cumulative windows back to original media timestamps (`map_window_to_ranges`), and parses duration strings (`parse_duration_input`). |
| `src-tauri/src/processing/pipeline.rs` | **End-to-End Transcode Pipeline:** Coordinates the 5 processing phases: (0) Probe $\rightarrow$ (1) Silence Detection $\rightarrow$ (2) Split Planning $\rightarrow$ (3) Path Generation $\rightarrow$ (4) Disk Space Pre-flight $\rightarrow$ (5) Single-pass / per-part encoding (`filter_complex` with `atrim` + `concat`). Emits real-time `JobEvent` updates. Cleans up `.part` files on failure or cancellation. On Android, invokes `publish_outputs_via_jni` to commit files to MediaStore. |

#### Queue System (`src-tauri/src/queue/`)

| File | Purpose & Details |
| :--- | :--- |
| `src-tauri/src/queue/mod.rs` | **Job Queue Manager:** Thread-safe state container (`QueueManager`) managing active worker threads, FIFO job queue (`order`), per-job cancellation tokens (`tokens`), job state history (`jobs`), and atomic concurrency limits. Emits `job-event` and `queue-idle` to frontend. |

#### Tests (`src-tauri/tests/`)

| File | Purpose & Details |
| :--- | :--- |
| `src-tauri/tests/e2e.rs` | **End-to-End Integration Suite:** Generates real synthetic media files using FFmpeg (`testsrc`, `sine`, `anullsrc`) and runs the actual pipeline, testing straight conversion, split with remainder, silence removal, post-silence splitting, Persian filenames, missing audio track handling, trimming windows, and cancellation process termination. |

---

### 🛠️ Build & Packaging Scripts (`scripts/`)

| File | Purpose & Details |
| :--- | :--- |
| `scripts/fetch-ffmpeg.mjs` | **FFmpeg Fetcher/Builder Node Script:** Automates acquiring bundled binaries. On macOS/Linux, invokes `build-ffmpeg-minimal.sh`. On Windows, downloads official BtbN LGPL static build. On Android (`aarch64-linux-android`), builds or downloads Android LGPL binaries. |
| `scripts/build-ffmpeg-minimal.sh` | **Minimal Static LGPL FFmpeg Builder:** Shell script downloading and building minimal FFmpeg 8.1.2, LAME 3.100, and Opus 1.6.1 from source with all non-LGPL and video encoder options disabled. |
| `scripts/build-android-local.sh` | **Automated Local Android Builder:** Builds frontend, exports Specta bindings, runs `tauri android build --apk --target aarch64`, verifies APK `libffmpeg.so`/`libffprobe.so` integrity, signs APK with persistent release keystore, and outputs production APK. |
| `scripts/dev-android.sh` | **Android Live Development Script:** Launches Vite dev server with `TAURI_DEV_HOST`, sets up ADB reverse port forwarding, patches project, and launches app on emulator with live HMR. |
| `scripts/run-android-emulator.sh` | **Android Emulator Starter:** Automates launching the local ARM64 Android emulator (`pixel_7_arm64` or first available AVD). |
| `scripts/patch-android-project.sh` | **Android Project Patcher:** Injects permissions (`READ_MEDIA_AUDIO`, `READ_MEDIA_VIDEO`), patches ProGuard rules (`proguard-rules.pro`), copies `MainActivity.kt`, and packages `libffmpeg.so` / `libffprobe.so` into `jniLibs/arm64-v8a`. |
| `scripts/gen-icons.py` | **App Icon Generator:** Standalone Python script generating PNG icons (16x16 up to 1024x1024), Android mipmaps, `icon.ico` for Windows, and `icon.icns` for macOS. |

---

## ⚡ 4. IPC Interface & Data Contracts

### 4.1 Commands (Frontend $\rightarrow$ Backend)

| Command | Arguments | Return Type | Description |
| :--- | :--- | :--- | :--- |
| `probe_files` | `paths: Vec<String>` | `Vec<FileMeta>` | Probes media format and audio streams for given paths. |
| `stat_media_paths` | `paths: Vec<String>` | `Vec<StatMediaPath>` | (Android/Desktop) Queries metadata and size for paths or `content://` URIs via JNI. |
| `resolve_media_paths` | `paths: Vec<String>` | `Vec<ResolvedMediaPath>` | (Android) Stages `content://` URIs to internal cache via JNI stream copies. |
| `has_media_permissions` | *None* | `bool` | Checks if Android media permissions are granted. |
| `request_media_permissions` | *None* | `void` | Triggers Android OS runtime permission dialog. |
| `open_app_settings` | *None* | `void` | Opens Android application system settings page. |
| `waveform_peaks`| `path: String, buckets: Option<usize>` | `Vec<[f32; 2]>` | Returns min/max amplitude peaks for waveform visualization. |
| `start_conversion` | `items: Vec<TrimSpec>, options: ConversionOptions, concurrency: Option<u32>` | `Vec<String>` | Enqueues a batch of files and starts worker threads. Returns job IDs. |
| `cancel_job` | `jobId: String` | `void` | Cancels a specific job, kills its FFmpeg process, and cleans temp files. |
| `cancel_all_jobs`| *None* | `void` | Cancels all running and waiting jobs. |
| `clear_finished` | *None* | `void` | Clears completed/failed/cancelled records from backend memory. |
| `get_queue` | *None* | `Vec<JobRecord>` | Returns snapshot of current job queue state. |
| `disk_free` | `path: String` | `{ freeBytes: number }`| Checks free disk space on the partition containing `path`. |
| `get_settings` | *None* | `AppSettings` | Loads persisted application settings. |
| `save_settings` | `settings: AppSettings` | `void` | Validates and persists settings to `settings.json`. |

### 4.2 Events (Backend $\rightarrow$ Frontend)

| Event Name | Payload Type | Description |
| :--- | :--- | :--- |
| `job-event` | `JobEvent` (`QueueItem`) | Emitted on every state transition (Waiting $\rightarrow$ Processing $\rightarrow$ Completed/Failed/Cancelled) and on percentage/speed updates. |
| `queue-idle` | `boolean` (`true`) | Emitted when all worker threads finish and the queue has no active tasks. Triggers auto-open output directory if enabled. |

---

## 🧠 5. Key Design Principles & Agent Invariants

When modifying or extending this codebase, any AI Agent or developer MUST adhere to these invariants:

1. **Structured Commands Only (Security Invariant):**
   - **Never** construct shell strings or execute FFmpeg via shell interpolation (`sh -c` or `cmd /c`).
   - Always use `std::process::Command` with structured argument vectors and place `--` immediately before output paths to prevent option injection attacks.

2. **Single Lossy Encode Invariant:**
   - Conversion operations (trimming, silence removal, splitting, downmixing, resampling, and encoding) must execute in a single FFmpeg pass per part using `-filter_complex` graphs. Never decode to intermediate lossy files.

3. **Post-Silence Split Calculation:**
   - Splitting boundaries must be computed against the duration of the audio **after** silence is removed, and then mapped back to the source media timestamps via `split::map_window_to_ranges()`.

4. **Timestamp Seeking & Rebasing:**
   - Trimming start (`-ss`) must be placed **before** `-i` (fast input seeking).
   - Trimming end (`-to`) must be placed **after** `-i`, and its value must be rebased to `end - start` because input seeking resets the timestamp origin to 0.

5. **Non-Overwriting File Operations:**
   - Output paths must always pass through `naming::unique_path()`. If a file already exists, append `(1)`, `(2)`, etc., rather than overwriting.
   - Partial writes must always target `.part` temporary files (e.g. `filename.part.mp3`) and rename to the final path only upon zero exit status.

6. **Process Lifecycle & Cleanup:**
   - Every FFmpeg process must be attached to a `CancelToken`. On cancellation or application exit (`RunEvent::Exit`), child processes must be killed immediately and partial `.part` files deleted.

7. **LGPL Compliance:**
   - Only LGPL FFmpeg builds and libraries (`libmp3lame`, `libopus`, native AAC/FLAC/PCM) are allowed. Never introduce GPL-only libraries (`libx264`, `libx265`).

8. **Android JNI & ProGuard Retention Invariant:**
   - All Java/Kotlin methods called via JNI (`statUri`, `resolveUriToLocalPath`, `publishOutputs`, `hasMediaPermissions`, `requestMediaPermissions`, `openAppSettings`) MUST be annotated with `@androidx.annotation.Keep` and explicitly preserved in `proguard-rules.pro`. Release builds enable R8 tree-shaking, which strips methods without explicit keep rules.
   - When calling JNI methods from Rust, exceptions MUST be checked with `env.exception_check()`, logged with `env.exception_describe()`, and cleared with `env.exception_clear()` to avoid aborting the JVM.

9. **Android Scoped Storage & MediaStore Publishing Invariant:**
   - In Android 10+ (API 29–36), direct POSIX writes to shared storage are forbidden. Outputs are written into app-private internal cache (`/data/user/0/com.audioconverter.app/files/converted/`), then published to `MediaStore.Audio` under `Music/AudioConverter` via `publishOutputs`.
   - Content URIs from Document Provider/PhotoPicker must be queried using the Activity's `ContentResolver` (`instance?.contentResolver`) rather than `applicationContext` to preserve temporary read grants, and `takePersistableUriPermission` should be attempted.

---

## 🧪 6. Development & Verification Guide

### Desktop Development & Testing
```bash
# 1. Install frontend dependencies
pnpm install

# 2. Build or download bundled LGPL FFmpeg binaries
pnpm fetch:ffmpeg

# 3. Run desktop app in development mode
pnpm tauri dev

# 4. Run frontend unit tests (Vitest)
pnpm test

# 5. Run Rust backend unit tests
pnpm test:rust

# 6. Run full End-to-End integration tests (generates real videos & encodes)
cargo test --manifest-path src-tauri/Cargo.toml --test e2e
```

### Android Development & Testing
```bash
# 1. Start the Android emulator
bash scripts/run-android-emulator.sh

# 2. Live development with HMR over ADB
bash scripts/dev-android.sh

# 3. Full production release build, APK verification, signing & install
bash scripts/build-android-local.sh
```

---
*Generated automatically as the master Agent Handoff document for Audio Converter.*
