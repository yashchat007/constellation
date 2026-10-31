import { describe, expect, it } from "vitest";
import { buildMoodProfile, classifyMoodFromAudio } from "./classifier";
import type { MoodEngineInput } from "./types";

const baseInput: MoodEngineInput = {
  audio: null,
  playing: true,
  paused: false,
  autoMood: true,
  manualMood: null,
  sensitivity: 1,
  motionIntensity: 1,
  particleIntensity: 1,
};

describe("mood classifier", () => {
  it("uses manual override when set", () => {
    expect(
      classifyMoodFromAudio({ ...baseInput, manualMood: "dreamy" }),
    ).toBe("dreamy");
  });

  it("returns neutral without signal", () => {
    expect(classifyMoodFromAudio(baseInput)).toBe("neutral");
  });

  it("classifies high energy as energetic", () => {
    const category = classifyMoodFromAudio({
      ...baseInput,
      audio: {
        captureAvailable: true,
        isCapturing: true,
        isSignalPresent: true,
        sampleRate: 48000,
        rmsEnergy: 0.2,
        normalizedEnergy: 0.7,
        bassEnergy: 0.6,
        lowMidEnergy: 0.4,
        midEnergy: 0.5,
        highMidEnergy: 0.3,
        trebleEnergy: 0.3,
        spectralCentroid: 0.4,
        onsetStrength: 0.2,
        estimatedBpm: null,
        timestampMs: 1,
      },
    });
    expect(category).toBe("energetic");
  });

  it("reduces motion when paused", () => {
    const playing = buildMoodProfile({
      ...baseInput,
      audio: {
        captureAvailable: true,
        isCapturing: true,
        isSignalPresent: true,
        sampleRate: 48000,
        rmsEnergy: 0.1,
        normalizedEnergy: 0.5,
        bassEnergy: 0.4,
        lowMidEnergy: 0.3,
        midEnergy: 0.3,
        highMidEnergy: 0.2,
        trebleEnergy: 0.2,
        spectralCentroid: 0.4,
        onsetStrength: 0.1,
        estimatedBpm: null,
        timestampMs: 1,
      },
    });
    const paused = buildMoodProfile({ ...baseInput, playing: false, paused: true });
    expect(paused.movementSpeed).toBeLessThan(playing.movementSpeed);
  });
});
