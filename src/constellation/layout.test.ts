import { describe, expect, it } from "vitest";
import {
  activeNodeIndex,
  buildConstellationGraph,
  phraseForLine,
  phraseIdForLineIndex,
  validateLyricNodeMapping,
} from "./layout";
import { activeLineIndex } from "../lyrics/sync";
import type { LyricLine } from "../types";

function sampleLines(count: number): LyricLine[] {
  return Array.from({ length: count }, (_, i) => ({
    startMs: i * 3000,
    endMs: (i + 1) * 3000,
    text: `Line number ${i + 1} with words`,
    words: [
      {
        text: "Line",
        startMs: i * 3000,
        endMs: i * 3000 + 800,
        estimated: true,
      },
      {
        text: "number",
        startMs: i * 3000 + 800,
        endMs: i * 3000 + 1600,
        estimated: true,
      },
    ],
  }));
}

describe("buildConstellationGraph", () => {
  it("produces stable positions for the same input", () => {
    const lines = sampleLines(12);
    const a = buildConstellationGraph(lines, 1, { width: 800, height: 520 });
    const b = buildConstellationGraph(lines, 1, { width: 800, height: 520 });
    expect(a.phrases.length).toBe(12);
    for (let i = 0; i < a.phrases.length; i += 1) {
      expect(a.phrases[i].x).toBe(b.phrases[i].x);
      expect(a.phrases[i].y).toBe(b.phrases[i].y);
    }
  });

  it("spreads phrases across width and height", () => {
    const graph = buildConstellationGraph(sampleLines(16), 1, {
      width: 900,
      height: 600,
    });
    const xs = graph.phrases.map((p) => p.x);
    const ys = graph.phrases.map((p) => p.y);
    const xSpread = Math.max(...xs) - Math.min(...xs);
    const ySpread = Math.max(...ys) - Math.min(...ys);
    expect(xSpread).toBeGreaterThan(200);
    expect(ySpread).toBeGreaterThan(200);
  });

  it("maps every lyric line to exactly one node at the same index", () => {
    const lines = sampleLines(8);
    const graph = buildConstellationGraph(lines);
    expect(validateLyricNodeMapping(lines, graph)).toEqual([]);
    for (let i = 0; i < lines.length; i += 1) {
      expect(graph.phrases[i].lineIndex).toBe(i);
      expect(graph.phrases[i].id).toBe(phraseIdForLineIndex(i));
      expect(phraseForLine(graph, i)?.text).toBe(lines[i].text);
    }
  });

  it("keeps indices when empty lines are present", () => {
    const lines: LyricLine[] = [
      { startMs: 0, endMs: 2000, text: "first", words: [] },
      { startMs: 2000, endMs: 4000, text: "   ", words: [] },
      { startMs: 4000, endMs: 6000, text: "third", words: [] },
    ];
    const graph = buildConstellationGraph(lines);
    expect(graph.phrases.length).toBe(3);
    expect(graph.phrases[1].empty).toBe(true);
    expect(phraseForLine(graph, 2)?.text).toBe("third");
    expect(activeLineIndex(lines, 4500)).toBe(2);
    expect(phraseForLine(graph, activeLineIndex(lines, 4500))?.text).toBe(
      "third",
    );
  });

  it("gives duplicate text distinct node ids by line index", () => {
    const lines: LyricLine[] = [
      { startMs: 0, endMs: 2000, text: "same", words: [] },
      { startMs: 2000, endMs: 4000, text: "same", words: [] },
    ];
    const graph = buildConstellationGraph(lines);
    expect(graph.phrases[0].id).not.toBe(graph.phrases[1].id);
    expect(graph.phrases[0].x).not.toBe(graph.phrases[1].x);
  });

  it("selects active phrase by lyric line index", () => {
    const lines = sampleLines(5);
    const graph = buildConstellationGraph(lines);
    const idx = activeLineIndex(lines, 3000);
    expect(idx).toBe(1);
    expect(phraseForLine(graph, idx)?.lineIndex).toBe(1);
    expect(activeNodeIndex(graph, 3000)).toBe(1);
  });

  it("connects sequential line ids", () => {
    const graph = buildConstellationGraph(sampleLines(4));
    expect(graph.edges).toContainEqual(["line-0", "line-1"]);
    expect(graph.edges).toContainEqual(["line-2", "line-3"]);
  });
});

describe("active line with unsorted timestamps", () => {
  it("picks the line with the greatest start still <= time", () => {
    const lines: LyricLine[] = [
      { startMs: 6000, endMs: 8000, text: "late in file", words: [] },
      { startMs: 0, endMs: 2000, text: "early", words: [] },
      { startMs: 3000, endMs: 5000, text: "middle", words: [] },
    ];
    expect(activeLineIndex(lines, 3500)).toBe(2);
    const graph = buildConstellationGraph(lines);
    expect(phraseForLine(graph, 2)?.text).toBe("middle");
  });
});
