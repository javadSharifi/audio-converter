/**
 * Lightweight platform detection from the webview user-agent.
 * Used to adapt UI that has no meaning on mobile (e.g. folder pickers,
 * opening an OS file explorer) and to route Android-specific behavior.
 */
export function isAndroid(): boolean {
  return typeof navigator !== "undefined" && /android/i.test(navigator.userAgent);
}

export function isMobile(): boolean {
  return isAndroid() || (typeof navigator !== "undefined" && /iphone|ipad|mobile/i.test(navigator.userAgent));
}

export function isWindows(): boolean {
  if (typeof navigator === "undefined") return false;
  const uaData = (navigator as unknown as { userAgentData?: { platform?: string } }).userAgentData;
  if (uaData?.platform) return /win/i.test(uaData.platform);
  return /win/i.test(navigator.userAgent);
}

export function isMacOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const uaData = (navigator as unknown as { userAgentData?: { platform?: string } }).userAgentData;
  if (uaData?.platform) return /mac/i.test(uaData.platform);
  return /mac/i.test(navigator.userAgent);
}

export function isLinux(): boolean {
  if (typeof navigator === "undefined") return false;
  const uaData = (navigator as unknown as { userAgentData?: { platform?: string } }).userAgentData;
  if (uaData?.platform) return /linux/i.test(uaData.platform);
  return /linux/i.test(navigator.userAgent);
}

export function isDesktop(): boolean {
  return !isAndroid() && (isWindows() || isMacOS() || isLinux());
}
