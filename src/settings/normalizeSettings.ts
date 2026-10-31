import type { AppSettings } from "../types";
import {
  buildDefaultAppSettings,
  INTERNAL_RUNTIME_DEFAULTS,
  USER_SETTINGS_DEFAULTS,
} from "./internalDefaults";

function lyricsViewMode(
  value: unknown,
): AppSettings["lyricsViewMode"] {
  return value === "traditional" ? "traditional" : "constellation";
}

/** Merge disk payload with defaults without clobbering saved user preferences. */
export function normalizeAppSettings(
  loaded: Partial<AppSettings> | null | undefined,
): AppSettings {
  const base = buildDefaultAppSettings();
  if (!loaded || typeof loaded !== "object") {
    return base;
  }

  return {
    ...INTERNAL_RUNTIME_DEFAULTS,
    ...USER_SETTINGS_DEFAULTS,
    lyricOffsetMs:
      typeof loaded.lyricOffsetMs === "number"
        ? loaded.lyricOffsetMs
        : USER_SETTINGS_DEFAULTS.lyricOffsetMs,
    textSize:
      typeof loaded.textSize === "number" && loaded.textSize > 0
        ? loaded.textSize
        : USER_SETTINGS_DEFAULTS.textSize,
    alwaysOnTop:
      typeof loaded.alwaysOnTop === "boolean"
        ? loaded.alwaysOnTop
        : USER_SETTINGS_DEFAULTS.alwaysOnTop,
    showConstellation:
      typeof loaded.showConstellation === "boolean"
        ? loaded.showConstellation
        : USER_SETTINGS_DEFAULTS.showConstellation,
    expandedPanel:
      typeof loaded.expandedPanel === "boolean"
        ? loaded.expandedPanel
        : USER_SETTINGS_DEFAULTS.expandedPanel,
    lyricsViewMode: lyricsViewMode(loaded.lyricsViewMode),
    accentColor: INTERNAL_RUNTIME_DEFAULTS.accentColor,
    autoTint: INTERNAL_RUNTIME_DEFAULTS.autoTint,
    themeTransitionMs: INTERNAL_RUNTIME_DEFAULTS.themeTransitionMs,
    audioReactiveEnabled: INTERNAL_RUNTIME_DEFAULTS.audioReactiveEnabled,
    audioCaptureEnabled: INTERNAL_RUNTIME_DEFAULTS.audioCaptureEnabled,
    audioSensitivity: INTERNAL_RUNTIME_DEFAULTS.audioSensitivity,
    audioMotionIntensity: INTERNAL_RUNTIME_DEFAULTS.audioMotionIntensity,
    audioParticleIntensity: INTERNAL_RUNTIME_DEFAULTS.audioParticleIntensity,
    audioSmoothing: INTERNAL_RUNTIME_DEFAULTS.audioSmoothing,
    autoMoodAdaptation: INTERNAL_RUNTIME_DEFAULTS.autoMoodAdaptation,
    manualMoodOverride: INTERNAL_RUNTIME_DEFAULTS.manualMoodOverride,
  };
}
