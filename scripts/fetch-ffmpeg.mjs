#!/usr/bin/env node
/**
 * Fetch or build the platform FFmpeg binaries for bundling (LGPL only).
 *
 * - macOS (arm64/x64): built from source via scripts/build-ffmpeg-macos.sh
 *   (prebuilt macOS artifacts are GPL; we ship LGPL).
 * - Linux x64: BtbN "latest-linux64-lgpl" archive.
 * - Windows x64: BtbN pinned stable-branch LGPL archive (sha256-verified).
 *
 * Output layout (Tauri externalBin naming):
 *   src-tauri/binaries/ffmpeg[-{target-triple}]
 *   src-tauri/binaries/ffprobe[-{target-triple}]
 */
import { execSync } from "node:child_process";
import {
  createWriteStream,
  createReadStream,
  existsSync,
  mkdirSync,
  copyFileSync,
  chmodSync,
} from "node:fs";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import os from "node:os";

const BIN_DIR = path.resolve(import.meta.dirname, "../src-tauri/binaries");

// Pinned to a stable FFmpeg branch instead of master — a master rebuild can
// silently change filter/encoder behavior underneath us. BtbN rotates the
// "latest" release daily and occasionally DROPS old-version assets (the 7.1
// asset vanished on 2026-08-30 → HTTP 404 mid-release), so the version suffix
// must be revisited when the branch ages out. Override with FFMPEG_WIN_ASSET.
const BTBN_RELEASE = "latest";
const WIN_FFMPEG_ASSET =
  process.env.FFMPEG_WIN_ASSET || "ffmpeg-n8.1-latest-win64-lgpl-8.1.zip";

function targetTriple() {
  if (process.env.TARGET_TRIPLE) return process.env.TARGET_TRIPLE;
  const arch = os.arch() === "x64" ? "x86_64" : "aarch64";
  switch (process.platform) {
    case "darwin": return `${arch}-apple-darwin`;
    case "win32": return `${arch}-pc-windows-msvc`;
    case "linux": return `${arch}-unknown-linux-gnu`;
    default: throw new Error(`Unsupported platform: ${process.platform}`);
  }
}

async function download(url, dest) {
  console.log(`downloading ${url}`);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  await pipeline(res.body, createWriteStream(dest));
}

async function sha256(file) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(file), hash);
  return hash.digest("hex");
}

function extractZip(zipPath, destDir) {
  mkdirSync(destDir, { recursive: true });
  if (process.platform === "win32") {
    try {
      execSync(`tar -xf ${JSON.stringify(zipPath)} -C ${JSON.stringify(destDir)}`, { stdio: "inherit" });
    } catch {
      // Single quotes are escaped by doubling; -LiteralPath avoids wildcard
      // interpretation on paths like C:\Users\O'Brien\AppData\Local\Temp\...
      const esc = (p) => p.replace(/'/g, "''");
      execSync(
        `powershell -NoProfile -Command "Expand-Archive -LiteralPath '${esc(zipPath)}' -DestinationPath '${esc(destDir)}' -Force"`,
        { stdio: "inherit" },
      );
    }
  } else {
    try {
      execSync(`unzip -q -o ${JSON.stringify(zipPath)} -d ${JSON.stringify(destDir)}`);
    } catch {
      execSync(`tar -xf ${JSON.stringify(zipPath)} -C ${JSON.stringify(destDir)}`);
    }
  }
}

// The inner folder name varies per build — locate binaries anywhere in the
// extracted tree instead of hardcoding it.
async function findBin(dir, name, depth = 0) {
  if (depth > 5) return null;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      const hit = await findBin(p, name, depth + 1);
      if (hit) return hit;
    } else if (e.name === name) {
      return p;
    }
  }
  return null;
}

async function btbNWin() {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "ff-btbn-"));
  const base = `https://github.com/BtbN/FFmpeg-Builds/releases/download/${BTBN_RELEASE}`;
  const zip = path.join(tmp, "ff.zip");
  await download(`${base}/${WIN_FFMPEG_ASSET}`, zip);

  // Verify against the checksum file published with the same release.
  const checksumsPath = path.join(tmp, "checksums.sha256");
  await download(`${base}/checksums.sha256`, checksumsPath);
  const lines = (await readFile(checksumsPath, "utf8"))
    .split("\n")
    .map((l) => l.trim().split(/\s+/))
    .filter((parts) => parts.length >= 2);
  const entry = lines.find((parts) => parts[parts.length - 1] === WIN_FFMPEG_ASSET);
  if (!entry) throw new Error(`No checksum entry for ${WIN_FFMPEG_ASSET}`);
  const actual = await sha256(zip);
  if (actual !== entry[0]) {
    throw new Error(
      `Checksum mismatch for ${WIN_FFMPEG_ASSET}: expected ${entry[0]}, got ${actual}`,
    );
  }
  console.log(`checksum ok: ${WIN_FFMPEG_ASSET}`);

  extractZip(zip, tmp);
  const ffmpeg = await findBin(tmp, "ffmpeg.exe");
  const ffprobe = await findBin(tmp, "ffprobe.exe");
  if (!ffmpeg || !ffprobe) {
    throw new Error("ffmpeg.exe / ffprobe.exe not found inside extracted archive");
  }
  return { ffmpeg, ffprobe };
}

async function main() {
  const triple = targetTriple();
  mkdirSync(BIN_DIR, { recursive: true });

  if (triple.includes("android")) {
    // Mirrors the per-arch build dir naming in build-ffmpeg-minimal.sh.
    const androidArch = triple.split("-")[0]; // aarch64 | armv7 | x86_64 | i686
    const buildDir = path.join(BIN_DIR, `build-minimal-android-${androidArch}`);
    execSync("bash scripts/build-ffmpeg-minimal.sh", {
      stdio: "inherit",
      env: { ...process.env, TARGET_TRIPLE: triple },
    });
    const paths = {
      ffmpeg: path.join(buildDir, "bin", "ffmpeg"),
      ffprobe: path.join(buildDir, "bin", "ffprobe"),
    };
    for (const name of ["ffmpeg", "ffprobe"]) {
      if (!existsSync(paths[name])) {
        throw new Error(`Expected ${paths[name]} to exist after build`);
      }
      const dest = path.join(BIN_DIR, `${name}-${triple}`);
      copyFileSync(paths[name], dest);
      try { chmodSync(dest, 0o755); } catch {}
      console.log(`installed ${dest}`);
    }
    return;
  }

  let paths;
  if (triple.endsWith("-apple-darwin") || triple.includes("linux")) {
    // Minimal static LGPL build from source (portable + small).
    execSync("bash scripts/build-ffmpeg-minimal.sh", { stdio: "inherit" });
    paths = {
      ffmpeg: path.join(BIN_DIR, "build-minimal", "bin", "ffmpeg"),
      ffprobe: path.join(BIN_DIR, "build-minimal", "bin", "ffprobe"),
    };
  } else {
    paths = await btbNWin();
  }

  const exe = triple.includes("windows") ? ".exe" : "";
  for (const name of ["ffmpeg", "ffprobe"]) {
    if (!existsSync(paths[name])) throw new Error(`${name} not produced`);
    // Triple-suffixed names are what Tauri's externalBin resolves at runtime;
    // unsuffixed copies serve cargo-test fallback and local dev.
    for (const suffix of [triple, ""]) {
      const base = suffix ? `${name}-${suffix}` : name;
      const dest = path.join(BIN_DIR, `${base}${exe}`);
      copyFileSync(paths[name], dest);
      try { chmodSync(dest, 0o755); } catch { /* chmod n/a on Windows */ }
      console.log(`installed ${dest}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
