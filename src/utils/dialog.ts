import { open } from "@tauri-apps/plugin-dialog";

const MEDIA_FILTER = {
  name: "Media",
  extensions: [
    // Video containers
    "mp4", "mkv", "avi", "mov", "webm", "flv", "wmv", "m4v", "ts", "mts", "3gp", "ogv",
    // Audio formats (audio → audio conversion)
    "mp3", "aac", "m4a", "wav", "flac", "opus", "ogg", "oga", "wma", "aiff", "aif", "amr", "ac3",
  ],
};

const AUDIO_EXTS = new Set([
  "mp3", "aac", "m4a", "wav", "flac", "opus", "ogg", "oga", "wma", "aiff", "aif", "amr", "ac3",
]);

/** True when a path looks like a pure audio file (not a video container). */
export function isAudioPath(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return AUDIO_EXTS.has(ext);
}

/** Open the native multi-select dialog and return absolute paths. */
export async function pickVideos(): Promise<string[]> {
  const picked = await open({ multiple: true, filters: [MEDIA_FILTER] });
  if (!picked) return [];
  return (Array.isArray(picked) ? picked : [picked]).map(String);
}
