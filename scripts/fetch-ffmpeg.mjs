#!/usr/bin/env node
/**
 * Fetch or build the platform FFmpeg binaries for bundling (LGPL only).
 *
 * - macOS (arm64/x64): built from source via scripts/build-ffmpeg-macos.sh
 *   (prebuilt macOS artifacts are GPL; we ship LGPL).
 * - Linux x64: BtbN "latest-linux64-lgpl" archive.
 * - Windows x64: BtbN "latest-win64-lgpl" archive.
 *
 * Output layout (Tauri externalBin naming):
 *   src-tauri/binaries/ffmpeg[-{target-triple}]
 *   src-tauri/binaries/ffprobe[-{target-triple}]
 */
import { execSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import os from "node:os";

const BIN_DIR = path.resolve(import.meta.dirname, "../src-tauri/binaries");

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

async function btbNWin() {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "ff-btbn-"));
  const url =
    "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-lgpl.zip";
  const zip = path.join(tmp, "ff.zip");
  await download(url, zip);
  execSync(`unzip -q -o ${JSON.stringify(zip)} -d ${JSON.stringify(tmp)}`);
  return {
    ffmpeg: path.join(tmp, "ffmpeg-master-latest-win64-lgpl", "bin", "ffmpeg.exe"),
    ffprobe: path.join(tmp, "ffmpeg-master-latest-win64-lgpl", "bin", "ffprobe.exe"),
  };
}

async function main() {
  const triple = targetTriple();
  mkdirSync(BIN_DIR, { recursive: true });

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
      execSync(`cp ${JSON.stringify(paths[name])} ${JSON.stringify(dest)}`);
      try { execSync(`chmod 755 ${JSON.stringify(dest)}`); } catch { /* chmod n/a on Windows */ }
      console.log(`installed ${dest}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
