import {
  createPlaybackClockState,
  type PlaybackClockState,
} from "./sync";

/** One clock for classic lyrics + constellation (separate hook instances share this). */
let sharedPlaybackClock: PlaybackClockState = createPlaybackClockState();

export function getSharedPlaybackClock(): PlaybackClockState {
  return sharedPlaybackClock;
}

export function resetSharedPlaybackClock(trackKey: string | null | undefined) {
  if (trackKey && trackKey !== sharedPlaybackClock.lastTrackKey) {
    sharedPlaybackClock = createPlaybackClockState();
    sharedPlaybackClock.lastTrackKey = trackKey;
  }
}

/** Test-only reset */
export function replaceSharedPlaybackClock(clock: PlaybackClockState) {
  sharedPlaybackClock = clock;
}
