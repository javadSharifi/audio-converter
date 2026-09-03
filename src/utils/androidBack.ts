/**
 * Cooperative Android back-button handling.
 *
 * Native (MainActivity) consumes the hardware back press and re-dispatches it
 * as `ac:android-back`. Deep views (sheets, tabs, fullscreen) listen first and
 * call `markBackConsumed()` when they handle the press; outer handlers check
 * `wasBackConsumed()` and stay idle so a single press never triggers two
 * navigations at once.
 */

const CONSUMED_KEY = "__acBackConsumed";

export function markBackConsumed(): void {
  try {
    (window as unknown as Record<string, number>)[CONSUMED_KEY] = Date.now();
  } catch {}
}

export function wasBackConsumed(maxAgeMs = 750): boolean {
  try {
    const t = (window as unknown as Record<string, unknown>)[CONSUMED_KEY];
    if (typeof t !== "number") return false;
    return Date.now() - t < maxAgeMs;
  } catch {
    return false;
  }
}

export const ANDROID_BACK_EVENT = "ac:android-back";
