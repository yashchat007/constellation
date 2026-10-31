import type { ConstellationGraph, LayoutBounds, LyricLine, PhraseNode } from "../types";
import { phraseWordsFromLine } from "./types";

export interface LayoutViewport {
  width: number;
  height: number;
}

const DEFAULT_VIEWPORT: LayoutViewport = { width: 720, height: 480 };
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

export function phraseIdForLineIndex(lineIndex: number): string {
  return `line-${lineIndex}`;
}

function lineEndMs(lines: LyricLine[], index: number): number {
  if (index + 1 < lines.length) {
    return lines[index + 1].startMs ?? lines[index + 1].timeMs ?? 0;
  }
  const line = lines[index];
  return (line.endMs ?? line.startMs ?? 0) + 8000;
}

function hashSeed(lines: LyricLine[]): number {
  let h = 2166136261;
  for (let i = 0; i < lines.length; i += 1) {
    const t = lines[i].text;
    for (let j = 0; j < t.length; j += 1) {
      h ^= t.charCodeAt(j);
      h = Math.imul(h, 16777619);
    }
    h ^= i;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function estimatePhraseSize(text: string, textSize: number) {
  const len = text.length || 8;
  const w = Math.min(420, 52 + len * 6.8) * textSize;
  const lines = Math.max(1, Math.ceil(len / 38));
  const h = (22 + lines * 22) * textSize;
  return { w, h };
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function boxesOverlap(a: Box, b: Box, pad: number): boolean {
  return !(
    a.x + a.w + pad < b.x ||
    b.x + b.w + pad < a.x ||
    a.y + a.h + pad < b.y ||
    b.y + b.h + pad < a.y
  );
}

function layoutBounds(phrases: PhraseNode[], padding = 160): LayoutBounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  phrases.forEach((p) => {
    const { w, h } = estimatePhraseSize(p.empty ? "…" : p.text, 1);
    minX = Math.min(minX, p.x - w / 2);
    minY = Math.min(minY, p.y - h / 2);
    maxX = Math.max(maxX, p.x + w / 2);
    maxY = Math.max(maxY, p.y + h / 2);
  });
  if (!Number.isFinite(minX)) {
    return { minX: -200, minY: -200, maxX: 200, maxY: 200 };
  }
  return {
    minX: minX - padding,
    minY: minY - padding,
    maxX: maxX + padding,
    maxY: maxY + padding,
  };
}

function buildEdges(lineCount: number): Array<[string, string]> {
  const edges: Array<[string, string]> = [];
  for (let i = 0; i < lineCount - 1; i += 1) {
    edges.push([phraseIdForLineIndex(i), phraseIdForLineIndex(i + 1)]);
  }
  return edges;
}

function spiralCandidate(
  lineIndex: number,
  lineCount: number,
  seed: number,
  worldW: number,
  worldH: number,
): { x: number; y: number } {
  const n = Math.max(lineCount, 1);
  const t = (lineIndex + 0.5) / n;
  const angle = lineIndex * GOLDEN_ANGLE + (seed % 997) * 0.0027;
  const radius = Math.sqrt(t) * Math.min(worldW, worldH) * 0.52;
  const ellipseX = worldW * 0.52;
  const ellipseY = worldH * 0.48;
  const wobble =
    Math.sin(lineIndex * 0.73 + seed * 0.001) * worldW * 0.04 +
    Math.cos(lineIndex * 0.41) * worldH * 0.035;
  return {
    x: Math.cos(angle) * radius * (ellipseX / Math.max(ellipseY, 1)) + wobble,
    y: Math.sin(angle * 0.93 + 0.2) * radius + Math.cos(angle * 0.5) * radius * 0.15,
  };
}

function placePhrase(
  lineIndex: number,
  lineCount: number,
  text: string,
  textSize: number,
  worldW: number,
  worldH: number,
  seed: number,
  placed: Box[],
): { x: number; y: number } {
  const { w, h } = estimatePhraseSize(text, textSize);
  const base = spiralCandidate(lineIndex, lineCount, seed, worldW, worldH);
  const pad = 40 + textSize * 8;

  for (let attempts = 0; attempts < 36; attempts += 1) {
    const ring = Math.floor(attempts / 6);
    const step = attempts % 6;
    const ang = step * (Math.PI / 3) + ring * 0.35 + lineIndex * 0.08;
    const push = ring * 42 + (attempts % 3) * 18;
    const ox = base.x + Math.cos(ang) * push;
    const oy = base.y + Math.sin(ang) * push;
    const box: Box = { x: ox - w / 2, y: oy - h / 2, w, h };
    const hit = placed.some((b) => boxesOverlap(box, b, pad));
    if (!hit) {
      placed.push(box);
      return { x: ox, y: oy };
    }
  }

  placed.push({ x: base.x - w / 2, y: base.y - h / 2, w, h });
  return { x: base.x, y: base.y };
}

/**
 * One phrase node per lyric line index. Line N → id `line-N` → phrases[N].
 */
export function buildConstellationGraph(
  lines: LyricLine[],
  textSize = 1,
  viewport: LayoutViewport = DEFAULT_VIEWPORT,
): ConstellationGraph {
  const phrases: PhraseNode[] = new Array(lines.length);
  const placed: Box[] = [];
  const n = lines.length;
  const seed = hashSeed(lines);
  const worldW = viewport.width * 2.72;
  const worldH = viewport.height * 2.38;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const rawText = line.text ?? "";
    const text = rawText.trim();
    const empty = text.length === 0;
    const startMs = line.startMs ?? line.timeMs ?? 0;
    const endMs = line.endMs ?? lineEndMs(lines, lineIndex);
    const words = empty
      ? []
      : phraseWordsFromLine(text, startMs, endMs, line.words);
    const { x, y } = placePhrase(
      lineIndex,
      lines.length,
      empty ? "…" : text,
      textSize,
      worldW,
      worldH,
      seed,
      placed,
    );

    phrases[lineIndex] = {
      id: phraseIdForLineIndex(lineIndex),
      lineIndex,
      text: empty ? "" : text,
      x,
      y,
      startMs,
      endMs,
      words,
      empty,
    };
  }

  const bounds = layoutBounds(phrases);
  const spanY = bounds.maxY - bounds.minY;
  const layoutRowGap =
    n > 1 ? Math.max(72, spanY / Math.min(n, 12)) : Math.max(72, viewport.height * 0.12);

  return {
    phrases,
    lineCount: lines.length,
    edges: buildEdges(lines.length),
    bounds,
    seed,
    layoutRowGap,
    layoutViewport: { ...viewport },
  };
}

export function graphBounds(graph: ConstellationGraph): LayoutBounds {
  return graph.bounds;
}

export function phraseForLine(
  graph: ConstellationGraph,
  lineIndex: number,
): PhraseNode | undefined {
  if (lineIndex < 0 || lineIndex >= graph.lineCount) {
    return undefined;
  }
  return graph.phrases[lineIndex];
}

/** @deprecated */
export function phraseByLineIndex(
  graph: ConstellationGraph,
  lineIndex: number,
): PhraseNode | undefined {
  return phraseForLine(graph, lineIndex);
}

export function validateLyricNodeMapping(
  lines: LyricLine[],
  graph: ConstellationGraph,
): string[] {
  const errors: string[] = [];
  if (graph.lineCount !== lines.length) {
    errors.push(
      `lineCount mismatch: lyrics=${lines.length} graph=${graph.lineCount}`,
    );
  }
  if (graph.phrases.length !== lines.length) {
    errors.push(
      `phrases.length mismatch: lyrics=${lines.length} phrases=${graph.phrases.length}`,
    );
  }
  for (let i = 0; i < lines.length; i += 1) {
    const node = graph.phrases[i];
    if (!node) {
      errors.push(`missing node at index ${i}`);
      continue;
    }
    if (node.lineIndex !== i) {
      errors.push(`node at ${i} has lineIndex ${node.lineIndex}`);
    }
    if (node.id !== phraseIdForLineIndex(i)) {
      errors.push(`node at ${i} id ${node.id} expected ${phraseIdForLineIndex(i)}`);
    }
  }
  return errors;
}

export function activeNodeIndex(
  graph: ConstellationGraph,
  timeMs: number,
): number {
  let idx = -1;
  let bestStart = -1;
  for (let i = 0; i < graph.phrases.length; i += 1) {
    const start = graph.phrases[i].startMs;
    if (timeMs >= start && start >= bestStart) {
      idx = graph.phrases[i].lineIndex;
      bestStart = start;
    }
  }
  return idx;
}
