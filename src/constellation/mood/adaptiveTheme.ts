import type { SongPalette } from "../palette";
import type { MoodProfile } from "./types";

export interface ExtendedVisualTheme {
  palette: SongPalette;
  backgroundTint: string;
  movementSpeed: number;
  particleDensity: number;
  glowIntensity: number;
  connectionIntensity: number;
  cameraResponsiveness: number;
  pulseStrength: number;
  bassPulse: number;
  trebleSparkle: number;
  midActivity: number;
}

export function applyMoodToPalette(
  base: SongPalette,
  _mood: MoodProfile,
): SongPalette {
  return base;
}

export function buildExtendedTheme(
  basePalette: SongPalette,
  mood: MoodProfile,
  bassEnergy: number,
  trebleEnergy: number,
  onsetStrength: number,
  normalizedEnergy: number,
): ExtendedVisualTheme {
  const palette = applyMoodToPalette(basePalette, mood);
  const energyGlow = Math.min(1, normalizedEnergy * 0.35);
  return {
    palette,
    backgroundTint: palette.backgroundTint,
    movementSpeed: mood.movementSpeed * (0.85 + bassEnergy * 0.35),
    particleDensity: mood.particleDensity * (0.7 + trebleEnergy * 0.45),
    glowIntensity: mood.glowIntensity * (0.75 + energyGlow),
    connectionIntensity: mood.connectionIntensity * (0.8 + normalizedEnergy * 0.4),
    cameraResponsiveness: mood.cameraResponsiveness,
    pulseStrength: Math.min(1, mood.pulseStrength + onsetStrength * 0.22),
    bassPulse: bassEnergy,
    trebleSparkle: trebleEnergy,
    midActivity: Math.min(
      1,
      normalizedEnergy * 0.45 + bassEnergy * 0.25 + trebleEnergy * 0.15,
    ),
  };
}
