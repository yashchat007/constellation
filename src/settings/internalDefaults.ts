import type { AppSettings } from "../types";

/** User-facing defaults (persisted and editable in Settings). */
export const USER_SETTINGS_DEFAULTS: Pick<
  AppSettings,
  | "lyricOffsetMs"
  | "textSize"
  | "alwaysOnTop"
  | "showConstellation"
  | "expandedPanel"
  | "lyricsViewMode"
> = {
  lyricOffsetMs: 0,
  textSize: 1.32,
  alwaysOnTop: false,
  showConstellation: true,
  expandedPanel: true,
  lyricsViewMode: "constellation",
};

/** Automatic visual/audio behaviour — not exposed in Settings UI. */
export const INTERNAL_RUNTIME_DEFAULTS: Pick<
  AppSettings,
  | "accentColor"
  | "autoTint"
  | "themeTransitionMs"
  | "audioReactiveEnabled"
  | "audioCaptureEnabled"
  | "audioSensitivity"
  | "audioMotionIntensity"
  | "audioParticleIntensity"
  | "audioSmoothing"
  | "autoMoodAdaptation"
  | "manualMoodOverride"
> = {
  accentColor: "#E5BD65",
  autoTint: true,
  themeTransitionMs: 1750,
  audioReactiveEnabled: true,
  audioCaptureEnabled: true,
  audioSensitivity: 1,
  audioMotionIntensity: 1,
  audioParticleIntensity: 1,
  audioSmoothing: 0.22,
  autoMoodAdaptation: true,
  manualMoodOverride: null,
};

export function buildDefaultAppSettings(): AppSettings {
  return {
    ...USER_SETTINGS_DEFAULTS,
    ...INTERNAL_RUNTIME_DEFAULTS,
  };
}
