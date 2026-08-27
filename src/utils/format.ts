/** Format seconds as H:MM:SS (or M:SS under an hour). */
export function formatDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "0:00";
  const s = Math.round(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }
  return `${m}:${String(sec).padStart(2, "0")}`;
}

/**
 * Format seconds as an editor timecode: M:SS.t (or H:MM:SS.t past an hour).
 * One decimal — the trim editor's precision. Round-trips through
 * parseTimeInput.
 */
export function formatTimecode(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "0:00.0";
  const tenths = Math.round(totalSeconds * 10);
  const whole = Math.floor(tenths / 10);
  const frac = tenths % 10;
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const sec = whole % 60;
  const tail = `:${String(sec).padStart(2, "0")}.${frac}`;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}${tail}`;
  return `${m}${tail}`;
}

/** Human file size: B / KB / MB / GB with one decimal where useful. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = value >= 100 || unit === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unit]}`;
}

/**
 * Parse user split-duration input:
 * - plain number ("45", "90.5") → minutes → seconds
 * - "HH:MM:SS" or "MM:SS" → clock time → seconds
 */
export function parseDurationInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.includes(":")) {
    const parts = trimmed.split(":").map((p) => p.trim());
    if (parts.length > 3 || parts.some((p) => p === "" || !/^\d+(\.\d+)?$/.test(p))) {
      return null;
    }
    let secs = 0;
    for (const part of parts) secs = secs * 60 + Number(part);
    return secs > 0 ? secs : null;
  }
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const minutes = Number(trimmed);
  return minutes > 0 ? minutes * 60 : null;
}

/** Clamp helper used by numeric inputs. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Parse a trim timestamp ("HH:MM:SS", "MM:SS", "SS" or decimal seconds)
 * into seconds. Unlike parseDurationInput (split duration, minutes-based),
 * bare numbers here ARE seconds. Returns null for empty/garbage input.
 */
export function parseTimeInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!trimmed.includes(":")) {
    if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
    return Number(trimmed);
  }
  const parts = trimmed.split(":").map((p) => p.trim());
  if (parts.length > 3 || parts.some((p) => p === "" || !/^\d+(\.\d+)?$/.test(p))) {
    return null;
  }
  let secs = 0;
  for (const part of parts) secs = secs * 60 + Number(part);
  return secs;
}
