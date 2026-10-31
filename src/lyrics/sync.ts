import type { LyricLine } from "../types";

/** Greatest line index whose startMs is still <= timeMs (works even if lines are not sorted). */
export function activeLineIndex(
  lines: LyricLine[],
  timeMs: number,
): number {
  if (lines.length === 0) {
    return -1;
  }
  let idx = -1;
  let bestStart = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const start = lines[i].startMs ?? lines[i].timeMs ?? 0;
    if (timeMs >= start && start >= bestStart) {
      idx = i;
      bestStart = start;
    }
  }
  return idx;
}

export interface TimedWord {
  startMs: number;
  endMs: number;
  text?: string;
}

/** Active word within a single line; never crosses line boundaries. */
export function activeWordIndex(line: LyricLine, timeMs: number): number {
  const words = line.words;
  if (!words || words.length === 0) {
    return -1;
  }
  return activeWordIndexInTimedWords(words, timeMs);
}

export function activeWordIndexFromPhrase(
  words: Array<{ startMs: number; endMs: number }>,
  timeMs: number,
): number {
  return activeWordIndexInTimedWords(words, timeMs);
}

export function activeWordIndexInTimedWords(
  words: TimedWord[],
  timeMs: number,
): number {
  if (words.length === 0) {
    return -1;
  }
  const estimated = words.every(
    (w) => (w as { estimated?: boolean }).estimated !== false,
  );
  if (estimated) {
    let idx = -1;
    for (let i = 0; i < words.length; i += 1) {
      if (timeMs >= words[i].startMs) {
        idx = i;
      } else {
        break;
      }
    }
    return idx;
  }
  for (let i = 0; i < words.length; i += 1) {
    const w = words[i];
    if (timeMs >= w.startMs && timeMs < w.endMs) {
      return i;
    }
  }
  const last = words[words.length - 1];
  if (timeMs >= last.startMs) {
    return words.length - 1;
  }
  return -1;
}

export interface LyricPlaybackState {
  timeMs: number;
  activeLineIndex: number;
  activeLine: LyricLine | null;
  activeWordIndex: number;
}

/** Canonical lyric sync — single source for line/word selection from playback time. */
export function resolveLyricPlaybackState(
  lines: LyricLine[],
  timeMs: number,
): LyricPlaybackState {
  const lineIdx = activeLineIndex(lines, timeMs);
  const activeLine = lineIdx >= 0 ? (lines[lineIdx] ?? null) : null;
  const wordIdx =
    activeLine && activeLine.words?.length
      ? activeWordIndex(activeLine, timeMs)
      : -1;
  return {
    timeMs,
    activeLineIndex: lineIdx,
    activeLine,
    activeWordIndex: wordIdx,
  };
}

export function applyLyricOffset(positionMs: number, offsetMs: number): number {
  return Math.max(0, positionMs + offsetMs);
}

export interface PlaybackClockInput {
  positionMs: number | null;
  offsetMs: number;
  playing: boolean;
  anchorMs: number;
  anchorAt: number;
}

export interface PlaybackClockState {
  anchorMs: number;
  anchorAt: number;
  playing: boolean;
  /** Detect SMTC seek / track snap */
  lastPositionMs: number | null;
  /** Reset clock when track identity changes */
  lastTrackKey?: string | null;
}

export function createPlaybackClockState(): PlaybackClockState {
  return {
    anchorMs: 0,
    anchorAt: 0,
    playing: false,
    lastPositionMs: null,
    lastTrackKey: null,
  };
}

const SEEK_THRESHOLD_MS = 380;
const SOFT_DRIFT_MS = 90;

/** Call when SMTC position or play state changes — not every animation frame. */
export function syncPlaybackClock(
  clock: PlaybackClockState,
  positionMs: number | null | undefined,
  playing: boolean,
  now: number,
) {
  const pos = positionMs ?? clock.anchorMs;

  if (clock.playing !== playing) {
    clock.anchorMs = pos;
    clock.anchorAt = now;
    clock.playing = playing;
    clock.lastPositionMs = positionMs ?? null;
    return;
  }

  if (!playing) {
    if (clock.lastPositionMs !== positionMs) {
      clock.anchorMs = pos;
      clock.anchorAt = now;
      clock.lastPositionMs = positionMs ?? null;
    }
    return;
  }

  if (positionMs == null) {
    return;
  }

  if (clock.lastPositionMs == null) {
    clock.anchorMs = pos;
    clock.anchorAt = now;
    clock.lastPositionMs = positionMs;
    return;
  }

  const elapsed = now - clock.anchorAt;
  const predicted = clock.anchorMs + elapsed;
  const delta = positionMs - predicted;

  if (Math.abs(positionMs - (clock.lastPositionMs ?? positionMs)) > SEEK_THRESHOLD_MS) {
    clock.anchorMs = positionMs;
    clock.anchorAt = now;
    clock.lastPositionMs = positionMs;
    return;
  }

  if (Math.abs(delta) > SEEK_THRESHOLD_MS) {
    clock.anchorMs = positionMs;
    clock.anchorAt = now;
    clock.lastPositionMs = positionMs;
    return;
  }

  if (Math.abs(delta) > SOFT_DRIFT_MS) {
    clock.anchorMs = positionMs - elapsed;
    clock.anchorAt = now;
  }

  clock.lastPositionMs = positionMs;
  clock.playing = playing;
}

export function playbackTimeMs(
  input: PlaybackClockInput,
  now = performance.now(),
): number {
  const anchor = input.anchorMs ?? input.positionMs ?? 0;
  if (!input.playing) {
    return applyLyricOffset(anchor, input.offsetMs);
  }
  const elapsed = now - input.anchorAt;
  return applyLyricOffset(anchor + elapsed, input.offsetMs);
}

export function playbackTimeFromClock(
  clock: PlaybackClockState,
  offsetMs: number,
  playing: boolean,
  now = performance.now(),
): number {
  return playbackTimeMs(
    {
      positionMs: clock.anchorMs,
      offsetMs,
      playing,
      anchorMs: clock.anchorMs,
      anchorAt: clock.anchorAt,
    },
    now,
  );
}
