import type { LayoutBounds } from "../types";

/** Smooth camera with soft focus offset and ambient drift. */
export class ConstellationCamera {
  x = 0;
  y = 0;

  private targetX = 0;
  private targetY = 0;
  private focusOffsetX = -18;
  private focusOffsetY = -12;
  private driftPhase = 0;
  private bounds: LayoutBounds | null = null;

  setFocusOffset(x: number, y: number) {
    this.focusOffsetX = x;
    this.focusOffsetY = y;
  }

  setBounds(bounds: LayoutBounds | null) {
    this.bounds = bounds;
  }

  setTarget(x: number, y: number) {
    this.targetX = x;
    this.targetY = y;
  }

  snapTo(x: number, y: number) {
    this.x = x;
    this.y = y;
    this.targetX = x;
    this.targetY = y;
  }

  /** @param dtMs delta time in milliseconds */
  update(
    dtMs: number,
    responsiveness = 1,
    playing = true,
    reducedMotion = false,
  ) {
    const driftAmp = reducedMotion ? 4 : playing ? 26 : 8;
    this.driftPhase += dtMs * (reducedMotion ? 0.00004 : 0.00011);
    const driftX = Math.sin(this.driftPhase * 0.71) * driftAmp;
    const driftY = Math.cos(this.driftPhase * 0.54) * driftAmp * 0.82;

    let goalX = this.targetX + this.focusOffsetX + driftX;
    let goalY = this.targetY + this.focusOffsetY + driftY;

    if (this.bounds) {
      const margin = 80;
      goalX = clamp(goalX, this.bounds.minX + margin, this.bounds.maxX - margin);
      goalY = clamp(goalY, this.bounds.minY + margin, this.bounds.maxY - margin);
    }

    const rate = 0.0022 * (0.55 + responsiveness * 0.65);
    const t = 1 - Math.exp(-dtMs * rate);
    this.x += (goalX - this.x) * t;
    this.y += (goalY - this.y) * t;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  if (lo > hi) {
    return (lo + hi) * 0.5;
  }
  return Math.max(lo, Math.min(hi, v));
}

export function computeViewScale(
  width: number,
  height: number,
  bounds: LayoutBounds,
): number {
  const worldW = Math.max(120, bounds.maxX - bounds.minX);
  const worldH = Math.max(120, bounds.maxY - bounds.minY);
  const scaleX = (width * 0.94) / worldW;
  const scaleY = (height * 0.9) / worldH;
  return Math.max(0.5, Math.min(2.35, Math.min(scaleX, scaleY)));
}

export interface ViewTransform {
  cx: number;
  cy: number;
  viewScale: number;
  cameraX: number;
  cameraY: number;
}

export function getViewTransform(
  width: number,
  height: number,
  bounds: LayoutBounds,
  cameraX: number,
  cameraY: number,
): ViewTransform {
  return {
    cx: width * 0.5,
    cy: height * 0.46,
    viewScale: computeViewScale(width, height, bounds),
    cameraX,
    cameraY,
  };
}

/** Screen coordinates → world space (matches renderer transform). */
export function screenToWorld(
  sx: number,
  sy: number,
  view: ViewTransform,
): { x: number; y: number } {
  const { cx, cy, viewScale, cameraX, cameraY } = view;
  const wx = (sx - cx) / viewScale + cameraX;
  const wy = (sy - cy) / viewScale + cameraY;
  return { x: wx, y: wy };
}
