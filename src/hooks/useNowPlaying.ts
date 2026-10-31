import { useEffect, useRef } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import type { NowPlaying } from "../types";
import { useAppStore } from "../stores/appStore";
import { trackIdentity } from "./useLyrics";

const POLL_IDLE_MS = 1200;
const POLL_ACTIVE_MS = 650;

export function useNowPlayingPoller() {
  const setNowPlaying = useAppStore((s) => s.setNowPlaying);
  const inFlight = useRef(false);
  const lastTrackKey = useRef<string | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;

    const schedule = (delayMs: number) => {
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current);
      }
      timerRef.current = window.setTimeout(tick, delayMs);
    };

    const tick = async () => {
      if (cancelled || inFlight.current) {
        schedule(POLL_ACTIVE_MS);
        return;
      }
      inFlight.current = true;
      try {
        const np = await invoke<NowPlaying>("get_now_playing");
        if (cancelled) return;
        const key = trackIdentity(np);
        if (key !== lastTrackKey.current) {
          lastTrackKey.current = key;
        }
        setNowPlaying(np);
        const playing = np?.status === "playing";
        schedule(playing ? POLL_ACTIVE_MS : POLL_IDLE_MS);
      } catch {
        if (!cancelled) {
          schedule(POLL_IDLE_MS);
        }
      } finally {
        inFlight.current = false;
      }
    };

    tick();
    return () => {
      cancelled = true;
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, [setNowPlaying]);
}

export async function mediaPlayPause() {
  await invoke("media_toggle_play_pause");
}

export async function mediaNext() {
  await invoke("media_skip_next");
}

export async function mediaPrevious() {
  await invoke("media_skip_previous");
}

export async function mediaSeek(positionMs: number) {
  if (!isTauri()) {
    return;
  }
  await invoke("media_seek_position", { positionMs: Math.max(0, Math.round(positionMs)) });
}
