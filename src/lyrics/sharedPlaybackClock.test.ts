import { describe, expect, it } from "vitest";
import {
  createPlaybackClockState,
  playbackTimeFromClock,
  syncPlaybackClock,
} from "./sync";
import {
  getSharedPlaybackClock,
  replaceSharedPlaybackClock,
  resetSharedPlaybackClock,
} from "./sharedPlaybackClock";

describe("sharedPlaybackClock", () => {
  it("resets on track key change", () => {
    const clock = createPlaybackClockState();
    syncPlaybackClock(clock, 5000, true, 1000);
    replaceSharedPlaybackClock(clock);
    resetSharedPlaybackClock("track-a");
    syncPlaybackClock(getSharedPlaybackClock(), 1000, true, 2000);
    expect(getSharedPlaybackClock().lastTrackKey).toBe("track-a");
    expect(playbackTimeFromClock(getSharedPlaybackClock(), 0, true, 2500)).toBe(
      1500,
    );
  });
});
