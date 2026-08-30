# Audio Converter

Desktop app that converts video files to audio (MP3 / WAV / AAC / M4A / FLAC / Opus),
with quality presets, fixed-duration splitting, silence removal, a processing queue,
real FFmpeg progress, and full Unicode (Persian) path support.

Built with **Tauri 2 + React + TypeScript + Tailwind CSS + Zustand**, with the media
pipeline implemented in **Rust** driving a **bundled LGPL FFmpeg** — end users need
zero external dependencies (no Node, no Python, no system FFmpeg).

## Features

- Drag-and-drop or file-dialog input (MP4/MKV/AVI/MOV/WEBM/FLV/WMV and anything
  FFmpeg can demux; validated by probing, not by extension).
- Output formats: MP3, WAV, AAC, M4A, FLAC, Opus. Format-appropriate settings
  (bitrate for lossy; sample-rate/channel options everywhere).
- Quality presets Low / Medium / High / Very High / Custom with explicit bitrate list.
- **Split into parts**: duration as minutes (`60`) or clock time (`1:00:00`); last part
  carries the remainder; source shorter than one part → single output.
- **Silence removal**: `silencedetect` scan + deterministic segment/concat cutting.
  Threshold dB presets (-20…-45) + custom; minimum-silence-duration presets.
- Split is always calculated against the **post-silence timeline**, so boundaries land
  where you expect after silence removal.
- Single-pass conversion: extraction, silence removal, splitting and encoding happen in
  one FFmpeg invocation via a single `filter_complex` graph — at most one lossy encode.
- Queue with per-file status (Waiting/Processing/Completed/Failed/Cancelled),
  per-file progress bars and overall progress. Concurrency configurable (default 1).
- Cancel kills the FFmpeg process and deletes partial `.part` files.
- Pre-flight disk-space check against estimated output size.
- Errors are user-readable with an optional "technical details" expander showing raw stderr.
- Light / Dark / System theme. English + Persian UI with RTL layout.
- Settings persisted to the OS data directory.

## Development

Prerequisites: Node.js ≥ 20, pnpm ≥ 9, Rust stable, plus `pkg-config`, `lame`, `opus`
(macOS Homebrew) or equivalent Linux packages — only needed to *build* FFmpeg locally.

```bash
pnpm install
pnpm fetch:ffmpeg     # build (macOS) or download (Win/Linux) bundled FFmpeg binaries
pnpm tauri dev        # run the app in development
```

## Building installers

```bash
pnpm fetch:ffmpeg     # ensure src-tauri/binaries/{ffmpeg,ffprobe}-<target-triple> exist
pnpm tauri build
```

Artifacts land in `src-tauri/target/release/bundle/`:

| Platform | Artifact |
| --- | --- |
| macOS | `dmg/AudioConverter_1.0.0_aarch64.dmg` (+ `.app`) |
| Windows | `nsis/AudioConverter_1.0.0_x64-setup.exe` |
| Linux | `deb/*.deb` and `appimage/*.AppImage` |

Windows and Linux packages are produced by CI (`.github/workflows/release.yml`) since
each platform's installer must be built on its own OS; each workflow runs
`pnpm fetch:ffmpeg` first so the correct platform binary is bundled automatically.

## Tests

```bash
pnpm test            # frontend unit tests (vitest)
pnpm test:rust       # Rust unit tests (naming, split math, silence parsing, settings…)
cargo test --manifest-path src-tauri/Cargo.toml --test e2e   # real end-to-end conversions
```

The E2E suite generates real sample videos (tone–silence–tone) with the bundled FFmpeg,
runs them through the actual pipeline, and asserts on output durations: straight MP3
conversion, split-with-remainder, silence removal shortening, split-after-silence
ordering, Persian filenames, no-audio-track failure handling, and cancel-kills-process.

## Security notes

FFmpeg/ffprobe are always invoked through Rust `std::process::Command` with structured
argument arrays — no shell interpolation of paths or filenames ever happens. The `--`
guard precedes every output path. Unicode/Persian paths are handled natively end-to-end.

## Third-party licenses

This application bundles **FFmpeg 7.1.1** binaries built from source under the
**GNU Lesser General Public License (LGPL) v2.1-or-later**:

- macOS & Linux binaries: compiled from official sources via
  `scripts/build-ffmpeg-minimal.sh` — fully static builds (only system libs
  linked) with libmp3lame + libopus, no GPL components. License: **LGPL v2.1+**.
- Windows binary: BtbN "lgpl" release archive, pinned to a stable branch
  (`ffmpeg-n8.1-latest-win64-lgpl-8.1.zip`), LGPL-licensed build.

These builds contain no GPL-only components (no libx264/x265). The app uses FFmpeg
solely via its command-line interface as a separate process, which constitutes use
"as a separate executable" under the LGPL; no static linking of FFmpeg libraries occurs.

Licensing summary:
- FFmpeg — LGPL v2.1+ (bundled binary, unmodified behavior, source available at ffmpeg.org)
- libmp3lame — LGPL v2+
- libopus — BSD 3-Clause
- Tauri & Rust crates — MIT/Apache-2.0
- React/Vite/Tailwind/Zustand/vitest — MIT

## Known limitations / follow-ups

- Windows SmartScreen will show an "unknown publisher" warning until code signing is
  set up (future improvement: Authenticode certificate in CI).
- macOS build is unsigned (no Developer ID); Gatekeeper right-click → Open on first run.
- Opus output forces 48 kHz when given unsupported rates (encoder requirement).
- WAV is written as 16-bit PCM for maximum compatibility.
- Android: inputs picked from SAF are staged once into the app cache (deduped per
  URI for the session); outputs are written internally and published to the shared
  `Music/AudioConverter` collection via MediaStore — custom output folders are
  therefore not available on Android. Conversions die if the app is killed in the
  background (foreground service with progress notification is a future improvement).
