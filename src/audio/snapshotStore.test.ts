import { describe, expect, it } from "vitest";
import { parseAudioSnapshot } from "./snapshotStore";

describe("parseAudioSnapshot", () => {
  it("parses camelCase payload", () => {
    const snap = parseAudioSnapshot({
      captureAvailable: true,
      isCapturing: true,
      isSignalPresent: true,
      rmsEnergy: 0.05,
      normalizedEnergy: 0.4,
      bassEnergy: 0.3,
      lowMidEnergy: 0.2,
      midEnergy: 0.25,
      highMidEnergy: 0.1,
      trebleEnergy: 0.15,
      spectralCentroid: 0.5,
      onsetStrength: 0.08,
      estimatedBpm: null,
      timestampMs: 99,
    });
    expect(snap?.normalizedEnergy).toBe(0.4);
    expect(snap?.isSignalPresent).toBe(true);
  });

  it("returns null for invalid payload", () => {
    expect(parseAudioSnapshot(null)).toBeNull();
  });
});
