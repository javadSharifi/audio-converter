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

async function btbN(kind) {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "ff-btbn-"));
  if (kind === "linux") {
    const url =
      "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-lgpl.tar.xz";
    const tarball = path.join(tmp, "ff.tar.xz");
    await download(url, tarball);
    execSync(`tar xf ${JSON.stringify(tarball)} -C ${JSON.stringify(tmp)}`);
    return {
      ffmpeg: path.join(tmp, "ffmpeg-master-latest-linux64-lgpl", "bin", "ffmpeg"),
      ffprobe: path.join(tmp, "ffmpeg-master-latest-linux64-lgpl", "bin", "ffprobe"),
    };
  }
  // windows
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
  if (triple.endsWith("-apple-darwin")) {
    execSync("bash scripts/build-ffmpeg-macos.sh", { stdio: "inherit" });
    paths = {
      ffmpeg: path.join(BIN_DIR, "build-macos", "bin", "ffmpeg"),
      ffprobe: path.join(BIN_DIR, "build-macos", "bin", "ffprobe"),
    };
  } else if (triple.includes("linux")) {
    paths = await btbN("linux");
  } else {
    paths = await btbN("win");
  }

  for (const name of ["ffmpeg", "ffprobe"]) {
    if (!existsSync(paths[name])) throw new Error(`${name} not produced`);
    // Triple-suffixed names are what Tauri's externalBin resolves at runtime;
    // unsuffixed copies serve cargo-test fallback and local dev.
    for (const suffix of [triple, ""]) {
      const dest = path.join(BIN_DIR, suffix ? `${name}-${suffix}` : name);
      execSync(`cp ${JSON.stringify(paths[name])} ${JSON.stringify(dest)}`);
      execSync(`chmod 755 ${JSON.stringify(dest)}`);
      console.log(`installed ${dest}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
