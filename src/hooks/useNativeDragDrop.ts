import { useEffect } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";

/**
 * Subscribes to native drag-and-drop events and forwards dropped file
 * system paths (Tauri gives real paths — HTML5 DnD does not).
 */
export function useNativeDragDrop(onDrop: (paths: string[]) => void): void {
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;

    getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type === "drop") {
          onDrop(event.payload.paths);
        }
      })
      .then((fn) => {
        if (disposed) {
          fn();
        } else {
          unlisten = fn;
        }
      })
      .catch(() => {
        // Webview event unavailable (e.g. tests) — ignore.
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [onDrop]);
}
