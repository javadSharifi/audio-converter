import type { StateCreator } from "zustand";

export interface ToastMessage {
  id: number;
  kind: "error" | "info" | "warning";
  text: string;
}

export interface ToastSlice {
  toasts: ToastMessage[];
  pushToast: (kind: ToastMessage["kind"], text: string) => void;
  dismissToast: (id: number) => void;
}

let toastSeq = 1;

export const createToastSlice: StateCreator<ToastSlice, [], [], ToastSlice> = (set, get) => ({
  toasts: [],

  pushToast(kind, text) {
    const id = toastSeq++;
    set((s) => ({ toasts: [...s.toasts, { id, kind, text }] }));
    window.setTimeout(() => get().dismissToast(id), 6000);
  },

  dismissToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
});
