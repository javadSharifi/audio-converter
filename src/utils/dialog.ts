import { open } from "@tauri-apps/plugin-dialog";

const VIDEO_FILTER = {
  name: "Video",
  extensions: ["mp4", "mkv", "avi", "mov", "webm", "flv", "wmv", "m4v", "ts", "mts", "3gp", "ogv"],
};

/** Open the native multi-select dialog and return absolute paths. */
export async function pickVideos(): Promise<string[]> {
  const picked = await open({ multiple: true, filters: [VIDEO_FILTER] });
  if (!picked) return [];
  return (Array.isArray(picked) ? picked : [picked]).map(String);
}
