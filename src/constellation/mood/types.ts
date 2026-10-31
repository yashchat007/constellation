import type { AudioFeatureSnapshot } from "../../types";

export type MoodCategory =
  | "melancholic"
  | "dreamy"
  | "romantic"
  | "energetic"
  | "upbeat"
  | "calm"
  | "atmospheric"
  | "neutral";

export interface MoodProfile {
  category: MoodCategory;
  energy: number;
  warmth: number;
  brightness: number;
  intensity: number;
  movementSpeed: number;
  particleDensity: number;
  glowIntensity: number;
  connectionIntensity: number;
  cameraResponsiveness: number;
  pulseStrength: number;
}

export interface MoodVisualParams {
  movementSpeed: number;
  particleDensity: number;
  glowIntensity: number;
  connectionIntensity: number;
  cameraResponsiveness: number;
  pulseStrength: number;
  bassPulse: number;
  trebleSparkle: number;
}

export interface MoodEngineInput {
  audio: AudioFeatureSnapshot | null;
  playing: boolean;
  paused: boolean;
  autoMood: boolean;
  manualMood: MoodCategory | null;
  sensitivity: number;
  motionIntensity: number;
  particleIntensity: number;
}
