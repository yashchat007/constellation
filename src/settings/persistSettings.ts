import { invoke, isTauri } from "@tauri-apps/api/core";
import type { AppSettings } from "../types";
import { normalizeAppSettings } from "./normalizeSettings";

const SAVE_DEBOUNCE_MS = 400;

let saveTimer: ReturnType<typeof setTimeout> | undefined;
let saveGeneration = 0;
let lastPersistedJson = "";
let hydrationComplete = false;

export type PersistStatus = "idle" | "saving" | "saved" | "error";

let status: PersistStatus = "idle";
const listeners = new Set<(s: PersistStatus) => void>();

export function getPersistStatus(): PersistStatus {
  return status;
}

export function subscribePersistStatus(listener: (s: PersistStatus) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function setStatus(next: PersistStatus) {
  status = next;
  listeners.forEach((l) => l(next));
}

export function markSettingsHydrated() {
  hydrationComplete = true;
}

export function isSettingsHydrated(): boolean {
  return hydrationComplete;
}

export async function loadSettingsFromDisk(): Promise<AppSettings> {
  if (!isTauri()) {
    return normalizeAppSettings(null);
  }
  try {
    const loaded = await invoke<AppSettings>("get_settings");
    const normalized = normalizeAppSettings(loaded);
    lastPersistedJson = JSON.stringify(normalized);
    return normalized;
  } catch {
    return normalizeAppSettings(null);
  }
}

export function schedulePersistSettings(settings: AppSettings) {
  if (!hydrationComplete || !isTauri()) {
    return;
  }
  const payload = JSON.stringify(settings);
  if (payload === lastPersistedJson) {
    return;
  }

  saveGeneration += 1;
  const gen = saveGeneration;
  if (saveTimer) {
    clearTimeout(saveTimer);
  }
  setStatus("saving");

  saveTimer = setTimeout(() => {
    void (async () => {
      if (gen !== saveGeneration) {
        return;
      }
      try {
        await invoke("set_settings", { settings });
        lastPersistedJson = payload;
        setStatus("saved");
        window.setTimeout(() => {
          if (status === "saved") {
            setStatus("idle");
          }
        }, 1800);
      } catch {
        setStatus("error");
      }
    })();
  }, SAVE_DEBOUNCE_MS);
}

export function resetPersistStateForTests() {
  saveGeneration = 0;
  lastPersistedJson = "";
  hydrationComplete = false;
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = undefined;
  }
  status = "idle";
  listeners.clear();
}
