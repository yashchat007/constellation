/** Responsive lyric sizing for canvas (CSS px at scale 1). */

export function viewportLyricMultiplier(
  width: number,
  height: number,
  userTextSize: number,
): number {
  const ref = Math.min(Math.max(width, 480), 1600);
  const refH = Math.min(Math.max(height, 360), 1200);
  const scale = Math.sqrt((ref * refH) / (720 * 480));
  const clamped = Math.max(0.92, Math.min(1.38, scale));
  return userTextSize * clamped;
}

export function activePhraseFontPx(lyricMul: number): number {
  return 26 * lyricMul;
}

export function nearbyPhraseFontPx(lyricMul: number): number {
  return 19 * lyricMul;
}

export function distantPhraseFontPx(lyricMul: number): number {
  return 16 * lyricMul;
}

export function activeWordBasePx(lyricMul: number): number {
  return 24 * lyricMul;
}
