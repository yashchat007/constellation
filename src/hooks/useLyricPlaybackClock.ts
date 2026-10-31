import { useCallback, useEffect, useRef } from "react";
import {
  playbackTimeFromClock,
  syncPlaybackClock,
} from "../lyrics/sync";
import {
  getSharedPlaybackClock,
  resetSharedPlaybackClock,
} from "../lyrics/sharedPlaybackClock";
import { useAppStore } from "../stores/appStore";

/** Single shared playback clock for classic + constellation views. */
export function useLyricPlaybackClock() {
  const nowPlaying = useAppStore((s) => s.nowPlaying);
  const offsetMs = useAppStore((s) => s.settings.lyricOffsetMs);
  const lyricsTrackKey = useAppStore((s) => s.lyrics?.trackKey);
  const npTrackKey = useAppStore((s) => s.nowPlaying?.trackKey);
  const clockRef = useRef(getSharedPlaybackClock());
  clockRef.current = getSharedPlaybackClock();

  useEffect(() => {
    resetSharedPlaybackClock(npTrackKey ?? lyricsTrackKey ?? null);
    clockRef.current = getSharedPlaybackClock();
  }, [npTrackKey, lyricsTrackKey]);

  useEffect(() => {
    const playing = nowPlaying?.status === "playing";
    syncPlaybackClock(
      getSharedPlaybackClock(),
      nowPlaying?.positionMs,
      playing,
      performance.now(),
    );
  }, [nowPlaying?.positionMs, nowPlaying?.status, offsetMs]);

  const getTimeMs = useCallback(
    (now = performance.now()) =>
      playbackTimeFromClock(
        getSharedPlaybackClock(),
        offsetMs,
        nowPlaying?.status === "playing",
        now,
      ),
    [offsetMs, nowPlaying?.status],
  );

  return { getTimeMs, clockRef };
}
