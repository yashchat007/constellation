import { describe, expect, it } from "vitest";
import {
  activeLineIndex,
  activeWordIndex,
  applyLyricOffset,
  createPlaybackClockState,
  playbackTimeFromClock,
  playbackTimeMs,
  resolveLyricPlaybackState,
  syncPlaybackClock,
} from "./sync";
import { buildConstellationGraph, phraseForLine } from "../constellation/layout";
import type { LyricLine } from "../types";

const lines: LyricLine[] = [
  { startMs: 1000, endMs: 3000, text: "one", words: [] },
  { startMs: 3000, endMs: 6000, text: "two", words: [] },
  { startMs: 6000, endMs: 9000, text: "three", words: [] },
];

describe("activeLineIndex", () => {
  it("returns -1 before first line", () => {
    expect(activeLineIndex(lines, 500)).toBe(-1);
  });

  it("selects line by start time", () => {
    expect(activeLineIndex(lines, 1000)).toBe(0);
    expect(activeLineIndex(lines, 3500)).toBe(1);
  });

  it("handles seek backward", () => {
    expect(activeLineIndex(lines, 7000)).toBe(2);
    expect(activeLineIndex(lines, 1500)).toBe(0);
  });
});

describe("offset and playback clock", () => {
  it("applies lyric offset", () => {
    expect(applyLyricOffset(3000, -500)).toBe(2500);
  });

  it("advances while playing using anchor clock", () => {
    const t0 = 1_000_000;
    const t = playbackTimeMs(
      {
        positionMs: 3000,
        offsetMs: 0,
        playing: true,
        anchorMs: 3000,
        anchorAt: t0,
      },
      t0 + 500,
    );
    expect(t).toBe(3500);
    expect(activeLineIndex(lines, t)).toBe(1);
  });

  it("freezes while paused", () => {
    const t = playbackTimeMs(
      {
        positionMs: 3500,
        offsetMs: 0,
        playing: false,
        anchorMs: 3500,
        anchorAt: performance.now(),
      },
      performance.now() + 5000,
    );
    expect(t).toBe(3500);
  });

  it("syncPlaybackClock only resets anchor on seek or poll", () => {
    const clock = createPlaybackClockState();
    syncPlaybackClock(clock, 1000, true, 10_000);
    expect(playbackTimeFromClock(clock, 0, true, 10_500)).toBe(1500);
    syncPlaybackClock(clock, 1000, true, 10_016);
    expect(playbackTimeFromClock(clock, 0, true, 10_500)).toBe(1500);
    syncPlaybackClock(clock, 4000, true, 20_000);
    expect(playbackTimeFromClock(clock, 0, true, 20_250)).toBe(4250);
  });
});

describe("activeWordIndex", () => {
  it("tracks word by startMs for estimated timings", () => {
    const line: LyricLine = {
      startMs: 1000,
      endMs: 4000,
      text: "hello world",
      words: [
        { text: "hello", startMs: 1000, endMs: 2000, estimated: true },
        { text: "world", startMs: 2000, endMs: 3500, estimated: true },
      ],
    };
    expect(activeWordIndex(line, 1500)).toBe(0);
    expect(activeWordIndex(line, 2000)).toBe(1);
    expect(activeWordIndex(line, 900)).toBe(-1);
  });

  it("uses endMs window for non-estimated words", () => {
    const line: LyricLine = {
      startMs: 0,
      endMs: 3000,
      text: "a b",
      words: [
        { text: "a", startMs: 0, endMs: 1500, estimated: false },
        { text: "b", startMs: 1500, endMs: 3000, estimated: false },
      ],
    };
    expect(activeWordIndex(line, 1499)).toBe(0);
    expect(activeWordIndex(line, 1500)).toBe(1);
  });
});

describe("resolveLyricPlaybackState", () => {
  it("matches line and node index", () => {
    const lines: LyricLine[] = [
      { startMs: 0, endMs: 2000, text: "a", words: [] },
      { startMs: 2000, endMs: 4000, text: "b", words: [] },
    ];
    const s = resolveLyricPlaybackState(lines, 2500);
    expect(s.activeLineIndex).toBe(1);
    expect(s.activeLine?.text).toBe("b");
  });
});

describe("line index matches constellation node", () => {
  it("active node text equals active lyric line", () => {
    const lyricLines: LyricLine[] = [
      {
        startMs: 0,
        endMs: 2000,
        text: "alpha",
        words: [{ text: "alpha", startMs: 0, endMs: 2000, estimated: true }],
      },
      {
        startMs: 2000,
        endMs: 4000,
        text: "beta",
        words: [{ text: "beta", startMs: 2000, endMs: 4000, estimated: true }],
      },
    ];
    const graph = buildConstellationGraph(lyricLines);
    const t = 2500;
    const idx = activeLineIndex(lyricLines, t);
    const node = phraseForLine(graph, idx);
    expect(lyricLines[idx].text).toBe(node?.text);
    expect(activeWordIndex(lyricLines[idx], t)).toBe(0);
  });
});
