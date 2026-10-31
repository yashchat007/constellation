import type { MoodCategory, MoodProfile } from "./types";
import type { MoodEngineInput } from "./types";

export const NEUTRAL_PROFILE: MoodProfile = {
  category: "neutral",
  energy: 0.35,
  warmth: 0.55,
  brightness: 0.5,
  intensity: 0.4,
  movementSpeed: 0.55,
  particleDensity: 0.6,
  glowIntensity: 0.45,
  connectionIntensity: 0.35,
  cameraResponsiveness: 0.5,
  pulseStrength: 0.3,
};

const PROFILE_BY_CATEGORY: Record<MoodCategory, MoodProfile> = {
  melancholic: {
    category: "melancholic",
    energy: 0.28,
    warmth: 0.72,
    brightness: 0.32,
    intensity: 0.38,
    movementSpeed: 0.42,
    particleDensity: 0.5,
    glowIntensity: 0.4,
    connectionIntensity: 0.3,
    cameraResponsiveness: 0.42,
    pulseStrength: 0.22,
  },
  dreamy: {
    category: "dreamy",
    energy: 0.32,
    warmth: 0.48,
    brightness: 0.58,
    intensity: 0.42,
    movementSpeed: 0.48,
    particleDensity: 0.72,
    glowIntensity: 0.52,
    connectionIntensity: 0.34,
    cameraResponsiveness: 0.46,
    pulseStrength: 0.28,
  },
  romantic: {
    category: "romantic",
    energy: 0.36,
    warmth: 0.78,
    brightness: 0.46,
    intensity: 0.44,
    movementSpeed: 0.5,
    particleDensity: 0.62,
    glowIntensity: 0.55,
    connectionIntensity: 0.38,
    cameraResponsiveness: 0.48,
    pulseStrength: 0.32,
  },
  energetic: {
    category: "energetic",
    energy: 0.78,
    warmth: 0.62,
    brightness: 0.68,
    intensity: 0.82,
    movementSpeed: 0.88,
    particleDensity: 0.85,
    glowIntensity: 0.75,
    connectionIntensity: 0.62,
    cameraResponsiveness: 0.72,
    pulseStrength: 0.7,
  },
  upbeat: {
    category: "upbeat",
    energy: 0.68,
    warmth: 0.58,
    brightness: 0.72,
    intensity: 0.7,
    movementSpeed: 0.78,
    particleDensity: 0.78,
    glowIntensity: 0.68,
    connectionIntensity: 0.55,
    cameraResponsiveness: 0.65,
    pulseStrength: 0.58,
  },
  calm: {
    category: "calm",
    energy: 0.22,
    warmth: 0.52,
    brightness: 0.44,
    intensity: 0.28,
    movementSpeed: 0.35,
    particleDensity: 0.48,
    glowIntensity: 0.35,
    connectionIntensity: 0.26,
    cameraResponsiveness: 0.38,
    pulseStrength: 0.18,
  },
  atmospheric: {
    category: "atmospheric",
    energy: 0.4,
    warmth: 0.5,
    brightness: 0.52,
    intensity: 0.48,
    movementSpeed: 0.52,
    particleDensity: 0.68,
    glowIntensity: 0.48,
    connectionIntensity: 0.4,
    cameraResponsiveness: 0.5,
    pulseStrength: 0.35,
  },
  neutral: NEUTRAL_PROFILE,
};

export function profileForCategory(category: MoodCategory): MoodProfile {
  return PROFILE_BY_CATEGORY[category] ?? NEUTRAL_PROFILE;
}

/** Heuristic visual mood from audio features — not emotional inference. */
export function classifyMoodFromAudio(
  input: MoodEngineInput,
): MoodCategory {
  if (input.manualMood) {
    return input.manualMood;
  }
  if (!input.autoMood || !input.audio?.isSignalPresent) {
    return "neutral";
  }

  const a = input.audio;
  const e = a.normalizedEnergy * input.sensitivity;
  const bass = a.bassEnergy;
  const treble = a.trebleEnergy;
  const bright = a.spectralCentroid;

  if (e < 0.12 && bass < 0.15) {
    return "calm";
  }
  if (e > 0.55 && bass > 0.45) {
    return "energetic";
  }
  if (e > 0.4 && bright > 0.55) {
    return "upbeat";
  }
  if (bright > 0.5 && treble > 0.35 && e < 0.45) {
    return "dreamy";
  }
  if (e < 0.28 && bright < 0.38) {
    return "melancholic";
  }
  if (e < 0.35 && bright < 0.45) {
    return "atmospheric";
  }
  if (e > 0.3 && e < 0.5 && bright < 0.5) {
    return "romantic";
  }
  return "neutral";
}

export function buildMoodProfile(input: MoodEngineInput): MoodProfile {
  const category = classifyMoodFromAudio(input);
  const base = profileForCategory(category);
  const motion = input.motionIntensity;
  const particles = input.particleIntensity;
  const sens = input.sensitivity;

  if (!input.playing || !input.audio?.isSignalPresent) {
    return {
      ...base,
      energy: base.energy * 0.45,
      movementSpeed: base.movementSpeed * 0.35 * motion,
      particleDensity: base.particleDensity * 0.5 * particles,
      glowIntensity: base.glowIntensity * 0.55,
      pulseStrength: base.pulseStrength * 0.25,
    };
  }

  const live = input.audio!;
  const boost = live.normalizedEnergy * sens;
  return {
    ...base,
    energy: Math.min(1, base.energy * 0.55 + boost * 0.55),
    movementSpeed: Math.min(1.2, base.movementSpeed * motion + live.bassEnergy * 0.2),
    particleDensity: Math.min(1.2, base.particleDensity * particles + live.trebleEnergy * 0.15),
    glowIntensity: Math.min(1, base.glowIntensity + boost * 0.35),
    connectionIntensity: Math.min(1, base.connectionIntensity + live.midEnergy * 0.35),
    cameraResponsiveness: Math.min(1, base.cameraResponsiveness + boost * 0.25),
    pulseStrength: Math.min(1, base.pulseStrength + live.onsetStrength * 0.65),
    brightness: Math.min(1, base.brightness + live.spectralCentroid * 0.25),
  };
}
