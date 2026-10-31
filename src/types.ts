import { buildDefaultAppSettings } from "./settings/internalDefaults";

export type PlaybackStatus = "none" | "playing" | "paused" | "stopped";

export type MoodCategory =
  | "melancholic"
  | "dreamy"
  | "romantic"
  | "energetic"
  | "upbeat"
  | "calm"
  | "atmospheric"
  | "neutral";

export interface NowPlaying {
  title: string | null;
  artist: string | null;
  album: string | null;
  status: PlaybackStatus;
  positionMs: number | null;
  durationMs: number | null;
  artworkDataUrl: string | null;
  trackKey: string | null;
}

export interface LyricWord {
  startMs: number;
  endMs: number;
  text: string;
  estimated: boolean;
}

export interface LyricLine {
  startMs: number;
  endMs: number;
  text: string;
  words: LyricWord[];
  /** Legacy alias for constellation layout */
  timeMs?: number;
}

export interface LyricsResult {
  lines: LyricLine[];
  source: string;
  trackKey: string;
  synced: boolean;
}

export interface AppSettings {
  lyricOffsetMs: number;
  textSize: number;
  accentColor: string;
  autoTint: boolean;
  themeTransitionMs: number;
  alwaysOnTop: boolean;
  showConstellation: boolean;
  expandedPanel: boolean;
  lyricsViewMode: "constellation" | "traditional";
  audioReactiveEnabled: boolean;
  audioCaptureEnabled: boolean;
  audioSensitivity: number;
  audioMotionIntensity: number;
  audioParticleIntensity: number;
  audioSmoothing: number;
  autoMoodAdaptation: boolean;
  manualMoodOverride: MoodCategory | null;
}

export interface AudioFeatureSnapshot {
  captureAvailable: boolean;
  isCapturing: boolean;
  isSignalPresent: boolean;
  sampleRate: number;
  rmsEnergy: number;
  normalizedEnergy: number;
  bassEnergy: number;
  lowMidEnergy: number;
  midEnergy: number;
  highMidEnergy: number;
  trebleEnergy: number;
  spectralCentroid: number;
  onsetStrength: number;
  estimatedBpm: number | null;
  timestampMs: number;
}

export interface AudioCaptureStatus {
  captureAvailable: boolean;
  isCapturing: boolean;
  lastError: string | null;
  sampleRate: number;
  chunksReceived: number;
  samplesReceived: number;
}

export const defaultSettings: AppSettings = buildDefaultAppSettings();

export interface PhraseWord {
  text: string;
  startMs: number;
  endMs: number;
  estimated: boolean;
}

export interface PhraseNode {
  id: string;
  lineIndex: number;
  text: string;
  x: number;
  y: number;
  startMs: number;
  endMs: number;
  words: PhraseWord[];
  /** Instrumental / blank LRC line — still occupies index N */
  empty: boolean;
}

export interface LayoutBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface ConstellationGraph {
  /** Dense array: phrases[i] is lyric line i (same length as lyrics.lines) */
  phrases: PhraseNode[];
  lineCount: number;
  edges: Array<[string, string]>;
  bounds: LayoutBounds;
  seed: number;
  layoutRowGap: number;
  layoutViewport: { width: number; height: number };
}
