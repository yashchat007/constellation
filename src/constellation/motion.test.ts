import { describe, expect, it } from "vitest";
import { phraseMotionOffset, createMotionState } from "./motion";
import type { ConstellationGraph } from "../types";

const mockGraph = {
  seed: 12345,
  phrases: [{ lineIndex: 0 }, { lineIndex: 1 }, { lineIndex: 2 }],
  lineCount: 3,
} as ConstellationGraph;

describe("phraseMotionOffset", () => {
  it("is deterministic for the same inputs", () => {
    const state = createMotionState(mockGraph);
    const a = phraseMotionOffset(state, 0, 12.5, true);
    const b = phraseMotionOffset(state, 0, 12.5, true);
    expect(a).toEqual(b);
  });

  it("reduces amplitude when paused", () => {
    const state = createMotionState(mockGraph);
    const playing = phraseMotionOffset(state, 1, 8, true);
    const paused = phraseMotionOffset(state, 1, 8, false);
    const playingMag = Math.hypot(playing.dx, playing.dy);
    const pausedMag = Math.hypot(paused.dx, paused.dy);
    expect(pausedMag).toBeLessThan(playingMag);
  });

  it("uses both axes over time (not vertical-only)", () => {
    const state = createMotionState(mockGraph);
    let maxDx = 0;
    let maxDy = 0;
    for (let t = 0; t < 120; t += 0.5) {
      const { dx, dy } = phraseMotionOffset(state, 1, t, true, 1, {
        intensity: 0.8,
        bass: 0.4,
        mid: 0.4,
        treble: 0.3,
        onset: 0.1,
      });
      maxDx = Math.max(maxDx, Math.abs(dx));
      maxDy = Math.max(maxDy, Math.abs(dy));
    }
    expect(maxDx).toBeGreaterThan(2);
    expect(maxDy).toBeGreaterThan(2);
  });
});
