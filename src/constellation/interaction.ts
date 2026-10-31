import type { ConstellationGraph, PhraseNode } from "../types";
import { estimatePhraseSize } from "./layout";
import type { ViewTransform } from "./camera";
import { screenToWorld } from "./camera";

export interface PointerInteraction {
  screenX: number;
  screenY: number;
  active: boolean;
  hoverLineIndex: number;
  focusLineIndex: number;
}

export const EMPTY_POINTER: PointerInteraction = {
  screenX: -9999,
  screenY: -9999,
  active: false,
  hoverLineIndex: -1,
  focusLineIndex: -1,
};

export function phraseHitRadius(text: string, textSize: number): number {
  const { w, h } = estimatePhraseSize(text, textSize);
  return Math.max(w, h) * 0.52;
}

export function findHoveredPhrase(
  graph: ConstellationGraph,
  worldX: number,
  worldY: number,
  textSize: number,
  phrasePositions: Map<number, { x: number; y: number }>,
): number {
  let best = -1;
  let bestDist = Infinity;
  for (let i = 0; i < graph.phrases.length; i += 1) {
    const phrase = graph.phrases[i];
    if (phrase.empty) {
      continue;
    }
    const pos = phrasePositions.get(i) ?? phrase;
    const r = phraseHitRadius(phrase.text || "…", textSize);
    const dx = worldX - pos.x;
    const dy = worldY - pos.y;
    const d = dx * dx + dy * dy;
    if (d < r * r && d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

export function resolvePointerHover(
  graph: ConstellationGraph,
  pointer: PointerInteraction,
  view: ViewTransform,
  textSize: number,
  phrasePositions: Map<number, { x: number; y: number }>,
): PointerInteraction {
  if (!pointer.active) {
    return { ...pointer, hoverLineIndex: -1 };
  }
  const world = screenToWorld(pointer.screenX, pointer.screenY, view);
  const hoverLineIndex = findHoveredPhrase(
    graph,
    world.x,
    world.y,
    textSize,
    phrasePositions,
  );
  return { ...pointer, hoverLineIndex };
}

export function phraseSeekTimeMs(phrase: PhraseNode): number {
  return phrase.startMs ?? 0;
}
