import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { buildConstellationGraph, validateLyricNodeMapping } from "../constellation/layout";
import { formatLyricsError } from "../lyrics/errorMessages";
import type { LyricsResult, NowPlaying } from "../types";
import { useAppStore } from "../stores/appStore";

const FETCH_TIMEOUT_MS = 55_000;

function normalizeLyricsResult(result: LyricsResult): LyricsResult {
  return {
    ...result,
    lines: result.lines.map((line) => ({
      ...line,
      timeMs: line.startMs ?? line.timeMs,
    })),
  };
}

function invokeWithTimeout<T>(
  cmd: string,
  args: Record<string, unknown>,
  timeoutMs: number,
): Promise<T> {
  return Promise.race([
    invoke<T>(cmd, args),
    new Promise<T>((_, reject) => {
      window.setTimeout(
        () => reject(new Error("Lyrics request timed out. Try Retry lyrics.")),
        timeoutMs,
      );
    }),
  ]);
}

export type LyricsFetchSkipReason = "fetch" | "skip_up_to_date" | "skip_in_flight";

/** Pure guard for when the lyrics loader should skip starting a new invoke. */
export function resolveLyricsFetchAction(input: {
  trackKey: string;
  lastLoadedKey: string | null;
  lyricsRetryNonce: number;
  lastRetryHandled: number;
  inFlightKey: string | null;
  loadedLyricsTrackKey: string | null;
}): LyricsFetchSkipReason {
  const {
    trackKey,
    lastLoadedKey,
    lyricsRetryNonce,
    lastRetryHandled,
    inFlightKey,
    loadedLyricsTrackKey,
  } = input;

  const lyricsMatchTrack =
    loadedLyricsTrackKey !== null && loadedLyricsTrackKey === trackKey;

  if (
    trackKey === lastLoadedKey &&
    lyricsRetryNonce === lastRetryHandled &&
    lyricsMatchTrack
  ) {
    return "skip_up_to_date";
  }

  if (
    inFlightKey === trackKey &&
    lyricsRetryNonce === lastRetryHandled
  ) {
    return "skip_in_flight";
  }

  return "fetch";
}

export function trackIdentity(np: NowPlaying | null): string | null {
  if (np?.trackKey) {
    return np.trackKey;
  }
  if (np?.title) {
    const t = np.title.toLowerCase();
    if (np.artist) {
      return `${np.artist.toLowerCase()}::${t}`;
    }
    return t;
  }
  return null;
}

export function viewportFromMainStage(): { width: number; height: number } {
  const stage = document.querySelector(".app-main");
  const rect = stage?.getBoundingClientRect();
  if (rect && rect.width > 0 && rect.height > 0) {
    return {
      width: Math.max(360, Math.floor(rect.width)),
      height: Math.max(280, Math.floor(rect.height)),
    };
  }
  return {
    width: Math.max(360, window.innerWidth),
    height: Math.max(280, window.innerHeight - 120),
  };
}

export function useLyricsLoader() {
  const trackKey = useAppStore((s) => s.nowPlaying?.trackKey);
  const title = useAppStore((s) => s.nowPlaying?.title);
  const artist = useAppStore((s) => s.nowPlaying?.artist);
  const durationMs = useAppStore((s) => s.nowPlaying?.durationMs);
  const album = useAppStore((s) => s.nowPlaying?.album);
  const lyricsRetryNonce = useAppStore((s) => s.lyricsRetryNonce);
  const setLyrics = useAppStore((s) => s.setLyrics);
  const setLyricsError = useAppStore((s) => s.setLyricsError);
  const setLyricsLoading = useAppStore((s) => s.setLyricsLoading);
  const setGraph = useAppStore((s) => s.setGraph);
  const fetchGeneration = useRef(0);
  const lastLoadedKey = useRef<string | null>(null);
  const lastRetryHandled = useRef(0);
  const inFlightKey = useRef<string | null>(null);

  useEffect(() => {
    const np = useAppStore.getState().nowPlaying;
    const key = trackIdentity(np);

    if (!key || !title?.trim()) {
      fetchGeneration.current += 1;
      inFlightKey.current = null;
      setLyricsLoading(false);
      setLyricsError(null);
      return;
    }

    const loadedLyricsTrackKey =
      useAppStore.getState().lyrics?.trackKey ?? null;
    const action = resolveLyricsFetchAction({
      trackKey: key,
      lastLoadedKey: lastLoadedKey.current,
      lyricsRetryNonce,
      lastRetryHandled: lastRetryHandled.current,
      inFlightKey: inFlightKey.current,
      loadedLyricsTrackKey,
    });
    if (action !== "fetch") {
      return;
    }

    const bypassNegativeCache = lyricsRetryNonce !== lastRetryHandled.current;

    if (bypassNegativeCache) {
      lastLoadedKey.current = null;
    }

    lastRetryHandled.current = lyricsRetryNonce;
    inFlightKey.current = key;

    fetchGeneration.current += 1;
    const generation = fetchGeneration.current;
    const isNewTrack = key !== lastLoadedKey.current;

    if (isNewTrack) {
      setLyrics(null);
      setGraph(null);
    }
    setLyricsError(null);
    setLyricsLoading(true);

    const artistStr = artist ?? "";
    const titleStr = title ?? "";

    (async () => {
      try {
        const result = normalizeLyricsResult(
          await invokeWithTimeout<LyricsResult>(
            "fetch_lyrics",
            {
              artist: artistStr,
              title: titleStr,
              album: album ?? "",
              durationMs,
              bypassNegativeCache,
              requestId: generation,
            },
            FETCH_TIMEOUT_MS,
          ),
        );
        if (generation !== fetchGeneration.current) {
          return;
        }
        if (trackIdentity(useAppStore.getState().nowPlaying) !== key) {
          return;
        }
        const vp = viewportFromMainStage();
        const graph = buildConstellationGraph(
          result.lines,
          useAppStore.getState().settings.textSize,
          vp,
        );
        const mapErrors = validateLyricNodeMapping(result.lines, graph);
        if (import.meta.env.DEV && mapErrors.length > 0) {
          console.warn("[constellation:sync] mapping validation", mapErrors);
        }
        setLyrics(result);
        setGraph(graph);
        setLyricsError(null);
        lastLoadedKey.current = key;
      } catch (e) {
        if (generation !== fetchGeneration.current) {
          return;
        }
        if (trackIdentity(useAppStore.getState().nowPlaying) !== key) {
          return;
        }
        const formatted = formatLyricsError(e);
        if (formatted.kind === "cancelled") {
          return;
        }
        if (formatted.message.includes("cancelled") || formatted.message.includes("superseded")) {
          return;
        }
        if (formatted.kind === "not_found" && isNewTrack) {
          setLyrics(null);
          setGraph(null);
        }
        setLyricsError(formatted.message);
        if (formatted.kind === "not_found") {
          lastLoadedKey.current = key;
        } else {
          lastLoadedKey.current = null;
        }
      } finally {
        if (inFlightKey.current === key) {
          inFlightKey.current = null;
        }
        if (generation === fetchGeneration.current) {
          setLyricsLoading(false);
        }
      }
    })();
  }, [
    trackKey,
    title,
    artist,
    durationMs,
    album,
    lyricsRetryNonce,
    setGraph,
    setLyrics,
    setLyricsError,
    setLyricsLoading,
  ]);
}

export async function importLrcFile() {
  const selected = await open({
    multiple: false,
    filters: [{ name: "LRC lyrics", extensions: ["lrc"] }],
  });
  if (!selected || Array.isArray(selected)) {
    return;
  }
  const { setLyrics, setGraph, setLyricsError, setLyricsLoading } =
    useAppStore.getState();
  try {
    setLyricsLoading(true);
    const result = normalizeLyricsResult(
      await invoke<LyricsResult>("load_lrc_file", { path: selected }),
    );
    const graph = buildConstellationGraph(
      result.lines,
      useAppStore.getState().settings.textSize,
      viewportFromMainStage(),
    );
    setLyrics(result);
    setGraph(graph);
    setLyricsError(null);
  } catch (e) {
    setLyricsError(formatLyricsError(e).message);
  } finally {
    setLyricsLoading(false);
  }
}

export function useDisplayTimeMs() {
  const nowPlaying = useAppStore((s) => s.nowPlaying);
  const offset = useAppStore((s) => s.settings.lyricOffsetMs);
  return (nowPlaying?.positionMs ?? 0) + offset;
}
