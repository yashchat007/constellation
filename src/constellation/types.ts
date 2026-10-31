import type {
  ConstellationGraph,
  LyricWord,
  PhraseNode,
  PhraseWord,
} from "../types";
import type { SongPalette } from "./palette";

export type { ConstellationGraph, PhraseNode, PhraseWord };

export const CONSTELLATION_THEME = {
  background: "#030303",
  goldPrimary: "#E5BD65",
  goldSecondary: "#8C713B",
  goldHighlight: "#F5D77A",
  textWarm: "#F5F0E5",
} as const;

export interface RenderTheme {
  accent: string;
  textSize: number;
  palette: SongPalette;
  backgroundTint?: string;
}

export interface RenderReactivity {
  movementSpeed: number;
  particleDensity: number;
  glowIntensity: number;
  connectionIntensity: number;
  pulseStrength: number;
  bassPulse: number;
  trebleSparkle: number;
  midActivity: number;
  cameraResponsiveness: number;
}

export interface RenderFrameInput {
  width: number;
  height: number;
  graph: ConstellationGraph;
  timeMs: number;
  playing: boolean;
  theme: RenderTheme;
  cameraX: number;
  cameraY: number;
  dpr: number;
  reactivity: RenderReactivity;
  pointer?: import("./interaction").PointerInteraction;
  reducedMotion?: boolean;
  motionEnergy?: import("./motion").MotionEnergy;
}

export function phraseWordsFromLine(
  text: string,
  startMs: number,
  endMs: number,
  words: LyricWord[] | undefined,
): PhraseWord[] {
  if (words && words.length > 0) {
    return words.map((w) => ({
      text: w.text,
      startMs: w.startMs,
      endMs: w.endMs,
      estimated: w.estimated,
    }));
  }
  const tokens = text
    .replace(/\([^)]*\)/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) {
    return [];
  }
  const span = Math.max(endMs - startMs, 1000);
  const step = span / tokens.length;
  return tokens.map((token, i) => ({
    text: token,
    startMs: Math.round(startMs + step * i),
    endMs: Math.round(startMs + step * (i + 1)),
    estimated: true,
  }));
}
