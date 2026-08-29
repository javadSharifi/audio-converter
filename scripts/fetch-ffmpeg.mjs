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

function extractZip(zipPath, destDir) {
  mkdirSync(destDir, { recursive: true });
  if (process.platform === "win32") {
    try {
      execSync(`tar -xf ${JSON.stringify(zipPath)} -C ${JSON.stringify(destDir)}`, { stdio: "inherit" });
    } catch {
      execSync(`powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force"`, { stdio: "inherit" });
    }
  } else {
    try {
      execSync(`unzip -q -o ${JSON.stringify(zipPath)} -d ${JSON.stringify(destDir)}`);
    } catch {
      execSync(`tar -xf ${JSON.stringify(zipPath)} -C ${JSON.stringify(destDir)}`);
    }
  }
}

async function btbNWin() {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "ff-btbn-"));
  const url =
    "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-lgpl.zip";
  const zip = path.join(tmp, "ff.zip");
  await download(url, zip);
  extractZip(zip, tmp);
  const ffmpeg = path.join(tmp, "ffmpeg-master-latest-win64-lgpl", "bin", "ffmpeg.exe");
  const ffprobe = path.join(tmp, "ffmpeg-master-latest-win64-lgpl", "bin", "ffprobe.exe");

  // Compress Windows binaries with UPX (LZMA) to reduce size by ~75%
  let upxExe = "upx";
  try {
    // Check if system has upx installed
    execSync("upx --version", { stdio: "ignore" });
  } catch {
    // Download portable UPX
    const upxUrl = "https://github.com/upx/upx/releases/download/v4.2.4/upx-4.2.4-win64.zip";
    const upxZip = path.join(tmp, "upx.zip");
    await download(upxUrl, upxZip);
    extractZip(upxZip, tmp);
    upxExe = path.join(tmp, "upx-4.2.4-win64", "upx.exe");
  }

  console.log(`compressing ${ffmpeg} with UPX...`);
  execSync(`${JSON.stringify(upxExe)} --best --lzma ${JSON.stringify(ffmpeg)}`, { stdio: "inherit" });

  console.log(`compressing ${ffprobe} with UPX...`);
  execSync(`${JSON.stringify(upxExe)} --best --lzma ${JSON.stringify(ffprobe)}`, { stdio: "inherit" });

  return { ffmpeg, ffprobe };
}

async function main() {
  const triple = targetTriple();
  mkdirSync(BIN_DIR, { recursive: true });

  if (triple.includes("android")) {
    execSync("bash scripts/build-ffmpeg-minimal.sh", {
      stdio: "inherit",
      env: { ...process.env, TARGET_TRIPLE: triple },
    });
    const paths = {
      ffmpeg: path.join(BIN_DIR, "build-minimal-android", "bin", "ffmpeg"),
      ffprobe: path.join(BIN_DIR, "build-minimal-android", "bin", "ffprobe"),
    };
    for (const name of ["ffmpeg", "ffprobe"]) {
      if (!existsSync(paths[name])) {
        throw new Error(`Expected ${paths[name]} to exist after build`);
      }
      const dest = path.join(BIN_DIR, `${name}-${triple}`);
      execSync(`cp ${JSON.stringify(paths[name])} ${JSON.stringify(dest)}`);
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
