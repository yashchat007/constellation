import type { LyricLine } from "../types";
import type { SongPalette } from "./palette";
import { DEFAULT_PALETTE, lerpOklabHex } from "./palette";
import {
  createMotionState,
  DEFAULT_MOTION_ENERGY,
  edgeMotionOffset,
  phraseMotionOffset,
  tickMotionState,
  type MotionEnergy,
  type MotionState,
} from "./motion";
import { getViewTransform } from "./camera";
import { EMPTY_POINTER } from "./interaction";
import type { ConstellationGraph, PhraseNode, RenderFrameInput, RenderReactivity } from "./types";
import {
  phraseLevelWordEmphasis,
  updateWordEmphasisLevels,
  wordScaleFromEmphasis,
  wordsHaveReliableSync,
} from "./wordEmphasis";
import { longWordScaleHint } from "../lyrics/romanizeDisplay";
import {
  activePhraseFontPx,
  activeWordBasePx,
  distantPhraseFontPx,
  nearbyPhraseFontPx,
  viewportLyricMultiplier,
} from "./typography";
import {
  createStarField,
  drawAtmosphereBackground,
  drawPointerGlow,
  drawStarField,
  type StarParticle,
  updateStarField,
} from "./particles";

const DEFAULT_REACT: RenderReactivity = {
  movementSpeed: 0.55,
  particleDensity: 0.6,
  glowIntensity: 0.45,
  connectionIntensity: 0.35,
  pulseStrength: 0.3,
  bassPulse: 0,
  trebleSparkle: 0,
  midActivity: 0.25,
  cameraResponsiveness: 0.5,
};

const MAX_VISIBLE_LINE_DIST = 8;

const FONT =
  '"Outfit", "Manrope", "Segoe UI Variable", system-ui, sans-serif';

export function lineNearActive(
  lineIndex: number,
  activeLine: number,
  maxDist = MAX_VISIBLE_LINE_DIST,
): boolean {
  if (activeLine < 0) {
    return lineIndex < 12;
  }
  return Math.abs(lineIndex - activeLine) <= maxDist;
}

const phraseMapCache = new WeakMap<
  ConstellationGraph,
  Map<string, PhraseNode>
>();

function phraseMap(graph: ConstellationGraph): Map<string, PhraseNode> {
  let map = phraseMapCache.get(graph);
  if (!map) {
    map = new Map(graph.phrases.map((p) => [p.id, p]));
    phraseMapCache.set(graph, map);
  }
  return map;
}

function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Target opacity from lyric distance to active line. */
export function phraseTargetOpacity(
  lineIndex: number,
  activeLine: number,
): number {
  if (activeLine < 0) {
    return 0.52;
  }
  const dist = Math.abs(lineIndex - activeLine);
  if (dist > 9) {
    return 0;
  }
  if (dist === 0) {
    return 1;
  }
  if (dist === 1) {
    return 0.78;
  }
  if (dist === 2) {
    return 0.58;
  }
  if (dist === 3) {
    return 0.48;
  }
  return Math.max(0.28, 0.44 - (dist - 4) * 0.04);
}

function drawHalo(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: string,
  alpha: number,
) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
  g.addColorStop(0, withAlpha(color, alpha));
  g.addColorStop(0.55, withAlpha(color, alpha * 0.35));
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
}

function wrapPhraseLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return [];
  }
  const lines: string[] = [];
  let current = words[0];
  for (let i = 1; i < words.length; i += 1) {
    const next = `${current} ${words[i]}`;
    if (ctx.measureText(next).width <= maxWidth) {
      current = next;
    } else {
      lines.push(current);
      current = words[i];
    }
  }
  lines.push(current);
  return lines;
}

function measureWordsWidth(
  ctx: CanvasRenderingContext2D,
  words: PhraseNode["words"],
  emphasis: number[],
  lyricMul: number,
): number {
  let total = 0;
  const gap = 10 * lyricMul;
  const base = activeWordBasePx(lyricMul);
  for (let i = 0; i < words.length; i += 1) {
    const size = base * wordScaleFromEmphasis(emphasis[i] ?? 0) * longWordScaleHint(words[i].text);
    const weight = (emphasis[i] ?? 0) > 0.72 ? 800 : (emphasis[i] ?? 0) > 0.45 ? 600 : 500;
    ctx.font = `${weight} ${size}px ${FONT}`;
    total += ctx.measureText(words[i].text).width + gap;
  }
  return Math.max(0, total - gap);
}

function drawPhraseWords(
  ctx: CanvasRenderingContext2D,
  phrase: PhraseNode,
  activeWord: number,
  lyricMul: number,
  layoutScale: number,
  _accent: string,
  phraseAlpha: number,
  palette: SongPalette,
  emphasis: number[],
) {
  const gap = 10 * lyricMul;
  const base = activeWordBasePx(lyricMul);
  const totalW = measureWordsWidth(ctx, phrase.words, emphasis, lyricMul);
  let x = phrase.x - totalW / 2;
  const y = phrase.y;

  for (let i = 0; i < phrase.words.length; i += 1) {
    const e = emphasis[i] ?? 0;
    const isActive = i === activeWord && activeWord >= 0;
    const isPast = activeWord >= 0 && i < activeWord;
    const size = base * wordScaleFromEmphasis(e) * longWordScaleHint(phrase.words[i].text);
    const weight = e > 0.72 ? 800 : e > 0.45 ? 600 : isPast ? 500 : 500;
    ctx.font = `${weight} ${size}px ${FONT}`;
    const width = ctx.measureText(phrase.words[i].text).width;

    let color: string = palette.inactiveText;
    let alpha = (0.58 + e * 0.14) * phraseAlpha;
    if (isPast) {
      color = lerpOklabHex(palette.text, palette.primary, 0.35);
      alpha = (0.72 + e * 0.12) * phraseAlpha;
    }
    if (isActive) {
      color = palette.primary;
      alpha = Math.min(1, phraseAlpha * (0.96 + e * 0.04));
      ctx.shadowColor = withAlpha(palette.primary, 0.72);
      ctx.shadowBlur = 18 * layoutScale * lyricMul * (0.75 + e * 0.45);
    } else {
      ctx.shadowBlur = 0;
    }

    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(phrase.words[i].text, x, y);
    ctx.shadowBlur = 0;
    x += width + gap;
  }
  ctx.globalAlpha = 1;
}


function drawPhraseLine(
  ctx: CanvasRenderingContext2D,
  phrase: PhraseNode,
  opacity: number,
  lyricMul: number,
  layoutScale: number,
  distFromActive: number,
  palette: SongPalette,
) {
  const isNear = distFromActive <= 1;
  const isMid = distFromActive <= 3;
  const size = isNear
    ? activePhraseFontPx(lyricMul)
    : isMid
      ? nearbyPhraseFontPx(lyricMul)
      : distantPhraseFontPx(lyricMul);
  const weight = isNear ? 600 : 500;
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const maxW = 380 * layoutScale * lyricMul;
  const lines = wrapPhraseLines(ctx, phrase.text, maxW);
  const lineHeight = size * 1.38;
  const startY = phrase.y - ((lines.length - 1) * lineHeight) / 2;

  const tone =
    distFromActive <= 1
      ? palette.text
      : distFromActive <= 3
        ? withAlpha(palette.text, 0.92)
        : withAlpha(palette.inactiveText, 0.88);

  ctx.fillStyle = tone;
  ctx.globalAlpha = opacity * (distFromActive <= 3 ? 0.95 : 0.78);
  for (let i = 0; i < lines.length; i += 1) {
    ctx.fillText(lines[i], phrase.x, startY + i * lineHeight);
  }
  ctx.globalAlpha = 1;

  ctx.beginPath();
  ctx.arc(phrase.x, startY - lineHeight * 0.85, 1.8 * layoutScale, 0, Math.PI * 2);
  ctx.fillStyle = withAlpha(palette.node, 0.42 * opacity);
  ctx.fill();
}

function edgeTargetOpacity(
  a: PhraseNode,
  b: PhraseNode,
  activeLine: number,
): number {
  if (Math.abs(a.lineIndex - b.lineIndex) !== 1) {
    return 0;
  }
  const touch =
    a.lineIndex === activeLine ||
    b.lineIndex === activeLine ||
    Math.abs(a.lineIndex - activeLine) === 1 ||
    Math.abs(b.lineIndex - activeLine) === 1;
  if (!touch) {
    return 0.04;
  }
  if (a.lineIndex === activeLine || b.lineIndex === activeLine) {
    return 0.38;
  }
  return 0.14;
}

export interface RendererState {
  particles: StarParticle[];
  bgParticles: StarParticle[];
  fgParticles: StarParticle[];
  lastGraph: ConstellationGraph | null;
  phraseAlpha: number[];
  edgeAlpha: number[];
  wordGlow: number;
  motion: MotionState | null;
  ambientPulse: number;
  idleParticles: StarParticle[];
  hoverGlow: number;
  wordEmphasis: number[];
  wordEmphasisLine: number;
}

export function createRendererState(): RendererState {
  return {
    particles: [],
    bgParticles: createStarField(7, 36, { layer: 0 }),
    fgParticles: [],
    lastGraph: null,
    phraseAlpha: [],
    edgeAlpha: [],
    wordGlow: 0,
    motion: null,
    ambientPulse: 0,
    idleParticles: createStarField(42, 40, { layer: 1 }),
    hoverGlow: 0,
    wordEmphasis: [],
    wordEmphasisLine: -1,
  };
}

function ensureVisualState(state: RendererState, graph: ConstellationGraph) {
  if (state.lastGraph !== graph) {
    state.particles = createStarField(graph.seed, 48, { layer: 1 });
    state.fgParticles = createStarField(graph.seed + 17, 20, { layer: 2 });
    state.bgParticles = createStarField(graph.seed + 3, 32, { layer: 0 });
    state.phraseAlpha = new Array(graph.lineCount).fill(0.52);
    state.edgeAlpha = new Array(graph.edges.length).fill(0.05);
    state.wordGlow = 0;
    state.motion = createMotionState(graph);
    state.wordEmphasis = [];
    state.wordEmphasisLine = -1;
    state.lastGraph = graph;
  }
}

function smoothStep(current: number, target: number, dtMs: number, rate: number) {
  const t = 1 - Math.exp(-dtMs * rate);
  return current + (target - current) * t;
}

function phrasePosition(
  phrase: PhraseNode,
  motion: MotionState | null,
  timeSec: number,
  playing: boolean,
  motionScale: number,
  energy: MotionEnergy,
  reducedMotion: boolean,
): { x: number; y: number } {
  if (!motion) {
    return { x: phrase.x, y: phrase.y };
  }
  const { dx, dy } = phraseMotionOffset(
    motion,
    phrase.lineIndex,
    timeSec,
    playing,
    motionScale,
    energy,
    reducedMotion,
  );
  return { x: phrase.x + dx, y: phrase.y + dy };
}

export function renderIdleConstellationFrame(
  ctx: CanvasRenderingContext2D,
  input: Pick<RenderFrameInput, "width" | "height" | "theme" | "dpr" | "playing">,
  state: RendererState,
  dtMs: number,
  message: string,
  subtitle?: string,
) {
  const { width, height, theme, dpr, playing } = input;
  const palette = theme.palette ?? DEFAULT_PALETTE;
  const accent = theme.accent || palette.primary;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  drawAtmosphereBackground(ctx, width, height, accent, palette.backgroundTint, 0, 0);
  updateStarField(state.idleParticles, dtMs, playing);
  drawStarField(
    ctx,
    state.idleParticles,
    0,
    0,
    width,
    height,
    0.02,
    palette.particle,
    palette.highlight,
  );

  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = palette.text;
  ctx.globalAlpha = 0.72;
  ctx.font = `500 1.05rem ${FONT}`;
  ctx.fillText(message, width * 0.5, height * 0.46);
  if (subtitle) {
    ctx.globalAlpha = 0.48;
    ctx.font = `400 0.86rem ${FONT}`;
    ctx.fillText(subtitle, width * 0.5, height * 0.52);
  }
  ctx.restore();
}

export function renderConstellationFrame(
  ctx: CanvasRenderingContext2D,
  input: RenderFrameInput,
  state: RendererState,
  dtMs: number,
  activeLineIndex: number,
  _activeLine: LyricLine | null,
  activeWordIdx: number,
) {
  const {
    width,
    height,
    graph,
    playing,
    theme,
    cameraX,
    cameraY,
    dpr,
    reactivity,
    pointer = EMPTY_POINTER,
    reducedMotion = false,
    motionEnergy = DEFAULT_MOTION_ENERGY,
  } = input;
  const react = reactivity ?? DEFAULT_REACT;
  const motionScale = react.movementSpeed;
  const palette = theme.palette ?? DEFAULT_PALETTE;
  const accent = theme.accent || palette.primary;
  const scale = theme.textSize;
  const lyricMul = viewportLyricMultiplier(width, height, scale);
  const timeSec = input.timeMs * 0.001;

  ensureVisualState(state, graph);

  if (state.motion) {
    tickMotionState(state.motion, dtMs, playing, motionEnergy, reducedMotion);
  }

  state.ambientPulse = smoothStep(
    state.ambientPulse,
    playing
      ? react.glowIntensity * (0.7 + react.pulseStrength * 0.35)
      : react.glowIntensity * 0.22,
    dtMs,
    0.004,
  );

  const view = getViewTransform(width, height, graph.bounds, cameraX, cameraY);
  const { cx, cy, viewScale } = view;

  const pointerWorld =
    pointer.active && pointer.screenX >= 0
      ? {
          worldX:
            (pointer.screenX - cx) / viewScale + cameraX,
          worldY:
            (pointer.screenY - cy) / viewScale + cameraY,
          active: true,
          strength: reducedMotion ? 0.15 : 0.55,
        }
      : undefined;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  drawAtmosphereBackground(
    ctx,
    width,
    height,
    palette.primary,
    palette.backgroundTint,
    cameraX,
    cameraY,
  );

  const particleActivity =
    react.particleDensity * (0.55 + react.bassPulse * 0.65 + react.trebleSparkle * 0.25);

  updateStarField(
    state.bgParticles,
    dtMs,
    playing,
    particleActivity * 0.45,
    pointerWorld,
    reducedMotion,
  );
  drawStarField(
    ctx,
    state.bgParticles,
    cameraX,
    cameraY,
    width,
    height,
    0.018,
    palette.particle,
    palette.highlight,
  );

  if (!reducedMotion) {
    updateStarField(
      state.particles,
      dtMs,
      playing,
      particleActivity,
      pointerWorld,
      reducedMotion,
    );
    updateStarField(
      state.fgParticles,
      dtMs,
      playing,
      particleActivity * 1.1,
      pointerWorld,
      reducedMotion,
    );
  } else {
    updateStarField(state.particles, dtMs, playing, particleActivity * 0.5);
    updateStarField(state.fgParticles, dtMs, playing, particleActivity * 0.5);
  }

  for (let i = 0; i < graph.lineCount; i += 1) {
    const target = phraseTargetOpacity(i, activeLineIndex);
    const rate = i === activeLineIndex ? 0.028 : 0.007;
    state.phraseAlpha[i] = smoothStep(
      state.phraseAlpha[i] ?? 0.4,
      target,
      dtMs,
      rate,
    );
    if (i === activeLineIndex && target >= 0.99) {
      state.phraseAlpha[i] = Math.max(state.phraseAlpha[i], 0.92);
    }
  }

  state.wordGlow = smoothStep(
    state.wordGlow,
    activeWordIdx >= 0 ? 1 : 0.6,
    dtMs,
    0.012,
  );

  const hoverTarget = pointer.hoverLineIndex >= 0 ? 1 : 0;
  state.hoverGlow = smoothStep(state.hoverGlow, hoverTarget, dtMs, 0.014);

  const activePhraseNode =
    activeLineIndex >= 0 ? graph.phrases[activeLineIndex] : undefined;
  if (activePhraseNode && !activePhraseNode.empty) {
    const wc = activePhraseNode.words.length;
    if (state.wordEmphasisLine !== activeLineIndex) {
      state.wordEmphasisLine = activeLineIndex;
      state.wordEmphasis = new Array(wc).fill(0);
    }
    if (state.wordEmphasis.length !== wc) {
      state.wordEmphasis = new Array(wc).fill(0);
    }
    const karaoke =
      wc > 0 &&
      wordsHaveReliableSync(activePhraseNode.words) &&
      activeWordIdx >= 0;
    if (wc > 0) {
      if (karaoke) {
        state.wordEmphasis = updateWordEmphasisLevels(
          state.wordEmphasis,
          wc,
          activeWordIdx,
          playing,
          dtMs,
        );
      } else if (playing) {
        state.wordEmphasis = phraseLevelWordEmphasis(wc, true);
      }
    }
  }

  const visualActiveWordIdx =
    activePhraseNode &&
    wordsHaveReliableSync(activePhraseNode.words) &&
    activeWordIdx >= 0
      ? activeWordIdx
      : -1;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(viewScale, viewScale);
  ctx.translate(-cameraX, -cameraY);

  drawStarField(
    ctx,
    state.particles,
    cameraX,
    cameraY,
    width,
    height,
    0.04 + react.trebleSparkle * 0.035,
    palette.particle,
    palette.highlight,
  );

  const motion = state.motion;
  const map = phraseMap(graph);
  const activePhrase =
    activeLineIndex >= 0 ? graph.phrases[activeLineIndex] : undefined;

  graph.edges.forEach(([fromId, toId], edgeIndex) => {
    const a = map.get(fromId);
    const b = map.get(toId);
    if (!a || !b || a.empty || b.empty) {
      return;
    }
    if (
      !lineNearActive(a.lineIndex, activeLineIndex) &&
      !lineNearActive(b.lineIndex, activeLineIndex)
    ) {
      return;
    }
    const pa = phrasePosition(
      a,
      motion,
      timeSec,
      playing,
      motionScale,
      motionEnergy,
      reducedMotion,
    );
    const pb = phrasePosition(
      b,
      motion,
      timeSec,
      playing,
      motionScale,
      motionEnergy,
      reducedMotion,
    );
    const edgeOff = motion
      ? edgeMotionOffset(motion, edgeIndex, timeSec, playing, motionEnergy)
      : { dx: 0, dy: 0 };
    const hoverEdge =
      pointer.hoverLineIndex >= 0 &&
      (a.lineIndex === pointer.hoverLineIndex ||
        b.lineIndex === pointer.hoverLineIndex);
    let target =
      edgeTargetOpacity(a, b, activeLineIndex) * react.connectionIntensity;
    target *= 0.85 + react.midActivity * 0.35;
    if (hoverEdge) {
      target = Math.max(target, 0.42);
    }
    state.edgeAlpha[edgeIndex] = smoothStep(
      state.edgeAlpha[edgeIndex] ?? target,
      target,
      dtMs,
      0.009,
    );
    const alpha = state.edgeAlpha[edgeIndex];
    if (alpha < 0.025) {
      return;
    }
    const nearActive =
      activePhrase &&
      (a.lineIndex === activeLineIndex || b.lineIndex === activeLineIndex);
    ctx.beginPath();
    ctx.moveTo(pa.x + edgeOff.dx * 0.15, pa.y + edgeOff.dy * 0.15);
    ctx.lineTo(pb.x - edgeOff.dx * 0.12, pb.y - edgeOff.dy * 0.12);
    ctx.strokeStyle = nearActive || hoverEdge
      ? withAlpha(palette.highlight, alpha * 0.9)
      : withAlpha(palette.connection, alpha);
    ctx.lineWidth = nearActive || hoverEdge ? 0.95 : 0.55;
    if (nearActive || hoverEdge) {
      ctx.shadowColor = withAlpha(accent, 0.28);
      ctx.shadowBlur = hoverEdge ? 5 : 4;
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
  });

  for (let i = 0; i < graph.phrases.length; i += 1) {
    const phrase = graph.phrases[i];
    if (phrase.empty) {
      continue;
    }
    const pos = phrasePosition(
      phrase,
      motion,
      timeSec,
      playing,
      motionScale,
      motionEnergy,
      reducedMotion,
    );
    const drawPhrase = { ...phrase, x: pos.x, y: pos.y };
    const opacity = state.phraseAlpha[phrase.lineIndex] ?? 0.48;
    if (opacity < 0.1) {
      continue;
    }
    const isActive = phrase.lineIndex === activeLineIndex;
    const isHover = phrase.lineIndex === pointer.hoverLineIndex;
    const dist = Math.abs(phrase.lineIndex - activeLineIndex);

    if (!isActive && !isHover && !lineNearActive(phrase.lineIndex, activeLineIndex)) {
      continue;
    }

    if (isActive) {
      drawHalo(
        ctx,
        drawPhrase.x,
        drawPhrase.y,
        140 * scale,
        accent,
        0.16 * state.ambientPulse,
      );
      drawHalo(
        ctx,
        drawPhrase.x,
        drawPhrase.y,
        64 * scale,
        palette.highlight,
        0.22 * state.wordGlow * state.ambientPulse,
      );
    } else if (isHover) {
      drawHalo(
        ctx,
        drawPhrase.x,
        drawPhrase.y,
        72 * scale,
        palette.highlight,
        0.12 * state.hoverGlow,
      );
    } else if (dist <= 2) {
      drawHalo(
        ctx,
        drawPhrase.x,
        drawPhrase.y,
        48 * scale,
        accent,
        0.05 * opacity,
      );
    }

    if (isHover && !isActive) {
      ctx.save();
      ctx.globalAlpha = opacity * (0.92 + state.hoverGlow * 0.08);
      drawPhraseLine(ctx, drawPhrase, 1, lyricMul, scale, dist, palette);
      ctx.restore();
    } else if (isActive && phrase.words.length > 0) {
      drawPhraseWords(
        ctx,
        drawPhrase,
        isActive && phrase.lineIndex === activeLineIndex
          ? visualActiveWordIdx
          : -1,
        lyricMul,
        scale,
        accent,
        opacity,
        palette,
        isActive ? state.wordEmphasis : phraseLevelWordEmphasis(phrase.words.length, true),
      );
    } else {
      drawPhraseLine(ctx, drawPhrase, opacity, lyricMul, scale, dist, palette);
    }
  }

  drawStarField(
    ctx,
    state.fgParticles,
    cameraX,
    cameraY,
    width,
    height,
    0.07 + react.trebleSparkle * 0.05,
    palette.highlight,
    palette.text,
  );

  ctx.restore();

  if (pointer.active) {
    drawPointerGlow(ctx, pointer.screenX, pointer.screenY, accent, state.hoverGlow * 0.65 + 0.25);
  }
}
