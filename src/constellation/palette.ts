/** Perceptual colour helpers + artwork-derived palettes (no forced gold). */

/** Canvas stays deep black — never song-tinted full-screen. */
export const CONSTELLATION_CANVAS_BG = "#030303";

export interface SongPalette {
  primary: string;
  secondary: string;
  highlight: string;
  text: string;
  ambient: string;
  node: string;
  connection: string;
  particle: string;
  backgroundTint: string;
  inactiveText: string;
}

/** Neutral fallback when artwork is missing — not gold. */
export const NEUTRAL_FALLBACK_PALETTE: SongPalette = {
  primary: "#B8B0A8",
  secondary: "#6E6860",
  highlight: "#E8E4DC",
  text: "#F0EBE3",
  ambient: "#8A8278",
  node: "#C4BCB2",
  connection: "#5A554E",
  particle: "#A59E94",
  backgroundTint: CONSTELLATION_CANVAS_BG,
  inactiveText: "#9A938A",
};

/** @deprecated use NEUTRAL_FALLBACK_PALETTE */
export const DEFAULT_PALETTE = NEUTRAL_FALLBACK_PALETTE;

const paletteCache = new Map<string, SongPalette>();

export function artworkCacheKey(trackKey: string, dataUrl: string): string {
  let h = 2166136261;
  const s = `${trackKey}|${dataUrl.slice(0, 256)}`;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return `#${[c(r), c(g), c(b)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function parseHex(hex: string): [number, number, number] {
  const x = hex.replace("#", "");
  return [
    parseInt(x.slice(0, 2), 16),
    parseInt(x.slice(2, 4), 16),
    parseInt(x.slice(4, 6), 16),
  ];
}

function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(c: number): number {
  const v = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
  return v * 255;
}

export function rgbToOklab(r: number, g: number, b: number): [number, number, number] {
  const rl = srgbToLinear(r);
  const gl = srgbToLinear(g);
  const bl = srgbToLinear(b);
  const l = 0.4122214708 * rl + 0.5363325363 * gl + 0.0514459929 * bl;
  const m = 0.2119034982 * rl + 0.6806995451 * gl + 0.1073969566 * bl;
  const s = 0.0883024619 * rl + 0.2817188376 * gl + 0.6299787005 * bl;
  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);
  return [
    0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.3559981738 * m_ + 0.2070250213 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  ];
}

export function oklabToRgb(L: number, a: number, b: number): [number, number, number] {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  const rl = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const gl = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  return [linearToSrgb(rl), linearToSrgb(gl), linearToSrgb(bl)];
}

export function lerpOklabHex(hexA: string, hexB: string, t: number): string {
  const u = Math.max(0, Math.min(1, t));
  if (u <= 0) {
    return hexA;
  }
  if (u >= 1) {
    return hexB;
  }
  const [ar, ag, ab] = parseHex(hexA);
  const [br, bg, bb] = parseHex(hexB);
  const [La, Aa, Ba] = rgbToOklab(ar, ag, ab);
  const [Lb, Ab, Bb] = rgbToOklab(br, bg, bb);
  const [r, g, b] = oklabToRgb(
    La + (Lb - La) * u,
    Aa + (Ab - Aa) * u,
    Ba + (Bb - Bb) * u,
  );
  return rgbToHex(r, g, b);
}

function luminance(r: number, g: number, b: number): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function saturate(r: number, g: number, b: number, amount: number): [number, number, number] {
  const lum = luminance(r, g, b);
  return [
    lum + (r - lum) * amount,
    lum + (g - lum) * amount,
    lum + (b - lum) * amount,
  ];
}

export interface RgbSwatch {
  r: number;
  g: number;
  b: number;
  weight: number;
}

export function selectDiverseSwatches(
  buckets: RgbSwatch[],
  count: number,
): RgbSwatch[] {
  if (buckets.length === 0) {
    return [{ r: 180, g: 175, b: 168, weight: 1 }];
  }
  const sorted = [...buckets].sort((a, b) => b.weight - a.weight);
  const chosen: RgbSwatch[] = [sorted[0]];
  for (let i = 1; i < sorted.length && chosen.length < count; i += 1) {
    const c = sorted[i];
    const [_, ca, cb] = rgbToOklab(c.r, c.g, c.b);
    const distinct = chosen.every((p) => {
      const [__, pa, pb] = rgbToOklab(p.r, p.g, p.b);
      return Math.hypot(ca - pa, cb - pb) > 0.075;
    });
    if (distinct) {
      chosen.push(c);
    }
  }
  while (chosen.length < count) {
    chosen.push(sorted[chosen.length % sorted.length]);
  }
  return chosen;
}

function clampChromaForDarkUi(
  r: number,
  g: number,
  b: number,
  maxChroma = 0.28,
): [number, number, number] {
  let [L, a, bb] = rgbToOklab(r, g, b);
  L = Math.max(0.38, Math.min(0.78, L));
  const c = Math.hypot(a, bb);
  if (c > maxChroma && c > 0.0001) {
    const s = maxChroma / c;
    a *= s;
    bb *= s;
  }
  return oklabToRgb(L, a, bb);
}

function liftHighlight(r: number, g: number, b: number): [number, number, number] {
  let [L, a, bb] = rgbToOklab(r, g, b);
  L = Math.max(L, 0.78);
  return oklabToRgb(L, a * 0.92, bb * 0.92);
}

export function buildSongPaletteFromSwatches(
  swatchA: [number, number, number],
  swatchB: [number, number, number],
  swatchC: [number, number, number],
): SongPalette {
  let [pr, pg, pb] = clampChromaForDarkUi(...swatchA, 0.42);
  let [sr, sg, sb] = clampChromaForDarkUi(...swatchB, 0.32);
  let [tr, tg, tb] = clampChromaForDarkUi(...swatchC, 0.34);
  [pr, pg, pb] = saturate(pr, pg, pb, 1.48);
  [sr, sg, sb] = saturate(sr, sg, sb, 1.28);

  const primary = rgbToHex(pr, pg, pb);
  const secondary = rgbToHex(sr * 0.82, sg * 0.82, sb * 0.82);
  const [hr, hg, hb] = liftHighlight(pr, pg, pb);
  const highlight = lerpOklabHex(
    rgbToHex(hr, hg, hb),
    lerpOklabHex(primary, "#F5F0E8", 0.25),
    0.55,
  );
  const node = lerpOklabHex(
    rgbToHex(tr, tg, tb),
    primary,
    0.35,
  );
  const text = lerpOklabHex(
    lerpOklabHex(primary, "#FFFFFF", 0.72),
    "#F5F0E8",
    0.35,
  );

  return {
    primary,
    secondary,
    highlight,
    text,
    ambient: lerpOklabHex(secondary, primary, 0.42),
    node,
    connection: lerpOklabHex(primary, secondary, 0.55),
    particle: lerpOklabHex(highlight, primary, 0.35),
    backgroundTint: CONSTELLATION_CANVAS_BG,
    inactiveText: lerpOklabHex(text, secondary, 0.42),
  };
}

export function buildSongPaletteFromPixelData(data: Uint8ClampedArray): SongPalette {
  const buckets = new Map<string, RgbSwatch>();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 48) continue;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const lum = luminance(r, g, b);
    if (lum < 0.06 || lum > 0.92) continue;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const sat = max === 0 ? 0 : (max - min) / max;
    if (sat < 0.1 && lum < 0.2) continue;
    const key = `${Math.floor(r / 20)},${Math.floor(g / 20)},${Math.floor(b / 20)}`;
    const cur = buckets.get(key) ?? { r: 0, g: 0, b: 0, weight: 0 };
    cur.r += r;
    cur.g += g;
    cur.b += b;
    cur.weight += (1 + sat * 2.4) * (0.35 + sat);
    buckets.set(key, cur);
  }

  const averaged: RgbSwatch[] = [...buckets.values()].map((c) => ({
    r: c.r / Math.max(1, c.weight),
    g: c.g / Math.max(1, c.weight),
    b: c.b / Math.max(1, c.weight),
    weight: c.weight,
  }));

  const [s0, s1, s2] = selectDiverseSwatches(averaged, 3);
  return buildSongPaletteFromSwatches(
    [s0.r, s0.g, s0.b],
    [s1.r, s1.g, s1.b],
    [s2.r, s2.g, s2.b],
  );
}

function pickPaletteFromPixels(data: Uint8ClampedArray): SongPalette {
  return buildSongPaletteFromPixelData(data);
}

export function contrastOnDarkBackground(hex: string): number {
  const [r, g, b] = parseHex(hex);
  return luminance(r, g, b);
}

export function clearPaletteCacheForTests() {
  paletteCache.clear();
}

export async function extractPaletteFromDataUrl(
  trackKey: string,
  dataUrl: string,
): Promise<SongPalette | null> {
  const key = artworkCacheKey(trackKey, dataUrl);
  const cached = paletteCache.get(key);
  if (cached) {
    return cached;
  }

  return new Promise((resolve) => {
    if (!isLikelyValidArtworkDataUrl(dataUrl)) {
      resolve(null);
      return;
    }
    const img = new Image();
    img.onload = () => {
      try {
        if (
          !isPlausibleArtworkDimensions(
            img.naturalWidth,
            img.naturalHeight,
            dataUrl.length,
          )
        ) {
          resolve(null);
          return;
        }
        const size = 64;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.drawImage(img, 0, 0, size, size);
        const palette = pickPaletteFromPixels(
          ctx.getImageData(0, 0, size, size).data,
        );
        paletteCache.set(key, palette);
        resolve(palette);
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

export function blendPalettes(
  from: SongPalette,
  to: SongPalette,
  t: number,
): SongPalette {
  const u = Math.max(0, Math.min(1, t));
  const ease = u * u * (3 - 2 * u);
  const lerp = (a: keyof SongPalette, b: keyof SongPalette) =>
    lerpOklabHex(from[a], to[b], ease);
  return {
    primary: lerp("primary", "primary"),
    secondary: lerp("secondary", "secondary"),
    highlight: lerp("highlight", "highlight"),
    text: lerp("text", "text"),
    ambient: lerp("ambient", "ambient"),
    node: lerp("node", "node"),
    connection: lerp("connection", "connection"),
    particle: lerp("particle", "particle"),
    backgroundTint: CONSTELLATION_CANVAS_BG,
    inactiveText: lerp("inactiveText", "inactiveText"),
  };
}

export function manualPaletteFromAccent(accent: string): SongPalette {
  const [r, g, b] = parseHex(accent);
  const secondary = rgbToHex(r * 0.55, g * 0.55, b * 0.55);
  return {
    primary: accent,
    secondary,
    highlight: lerpOklabHex(accent, "#F5F0E5", 0.35),
    text: "#F0EBE3",
    ambient: accent,
    node: lerpOklabHex(accent, "#ffffff", 0.25),
    connection: secondary,
    particle: lerpOklabHex(accent, "#ffffff", 0.4),
    backgroundTint: CONSTELLATION_CANVAS_BG,
    inactiveText: lerpOklabHex(secondary, "#888880", 0.5),
  };
}

type MoodCategory =
  | "melancholic"
  | "dreamy"
  | "romantic"
  | "energetic"
  | "upbeat"
  | "calm"
  | "atmospheric"
  | "neutral";

const MOOD_SWATCH_TRIPLETS: Record<
  MoodCategory,
  [[number, number, number], [number, number, number], [number, number, number]]
> = {
  melancholic: [
    [52, 68, 148],
    [88, 96, 168],
    [120, 130, 190],
  ],
  dreamy: [
    [148, 118, 210],
    [118, 148, 228],
    [180, 160, 230],
  ],
  romantic: [
    [210, 98, 128],
    [228, 140, 150],
    [240, 180, 170],
  ],
  energetic: [
    [255, 72, 120],
    [255, 120, 48],
    [88, 160, 255],
  ],
  upbeat: [
    [255, 148, 72],
    [255, 96, 120],
    [255, 196, 88],
  ],
  calm: [
    [148, 158, 188],
    [170, 140, 148],
    [130, 150, 170],
  ],
  atmospheric: [
    [72, 128, 148],
    [108, 88, 148],
    [140, 160, 180],
  ],
  neutral: [
    [140, 132, 124],
    [100, 108, 120],
    [168, 158, 148],
  ],
};

function hashTrackSeed(trackKey: string): number {
  let h = 2166136261;
  for (let i = 0; i < trackKey.length; i += 1) {
    h ^= trackKey.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seededSwatchesFromTrack(trackKey: string): [
  [number, number, number],
  [number, number, number],
  [number, number, number],
] {
  const h = hashTrackSeed(trackKey);
  const hue = (h % 360) / 360;
  const mk = (offset: number): [number, number, number] => {
    const ang = (hue + offset) * Math.PI * 2;
    const sat = 0.55 + ((h >> offset) & 7) / 28;
    const lum = 0.42 + ((h >> (offset + 3)) & 7) / 22;
    const c = (1 - Math.abs(2 * lum - 1)) * sat;
    const x = c * (1 - Math.abs(((ang / (Math.PI * 2)) * 6) % 2 - 1));
    const m = lum - c / 2;
    let r = 0;
    let g = 0;
    let b = 0;
    const sector = Math.floor((ang / (Math.PI * 2)) * 6) % 6;
    const vals = [c, x, 0, 0, x, c];
    const order = [
      [0, 1, 2],
      [1, 0, 2],
      [2, 0, 1],
      [2, 1, 0],
      [1, 2, 0],
      [0, 2, 1],
    ] as const;
    const rgb = order[sector];
    r = (vals[rgb[0]] + m) * 255;
    g = (vals[rgb[1]] + m) * 255;
    b = (vals[rgb[2]] + m) * 255;
    return [
      Math.max(48, Math.min(240, Math.round(r))),
      Math.max(48, Math.min(240, Math.round(g))),
      Math.max(48, Math.min(240, Math.round(b))),
    ];
  };
  return [mk(0), mk(0.17), mk(0.31)];
}

export function trackIdentityPalette(trackKey: string): SongPalette {
  const [a, b, c] = seededSwatchesFromTrack(trackKey);
  return buildSongPaletteFromSwatches(a, b, c);
}

export function moodPaletteForCategory(
  category: MoodCategory,
  trackKey?: string | null,
): SongPalette {
  if (category === "neutral" && trackKey) {
    return trackIdentityPalette(trackKey);
  }
  const triplet = MOOD_SWATCH_TRIPLETS[category];
  return buildSongPaletteFromSwatches(triplet[0], triplet[1], triplet[2]);
}

/** Hue angle 0–360 for palette diagnostics and tests. */
export function paletteHueDegrees(hex: string): number {
  const [r, g, b] = parseHex(hex);
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  if (max - min < 0.04) {
    return 0;
  }
  let h = 0;
  const d = max - min;
  if (max === rn) {
    h = ((gn - bn) / d) % 6;
  } else if (max === gn) {
    h = (bn - rn) / d + 2;
  } else {
    h = (rn - gn) / d + 4;
  }
  h *= 60;
  return h < 0 ? h + 360 : h;
}

export function isRedFamilyHue(degrees: number): boolean {
  return degrees <= 25 || degrees >= 335;
}

export function isPurpleFamilyHue(degrees: number): boolean {
  return degrees >= 240 && degrees <= 310;
}

export function solidColorPixelGrid(
  r: number,
  g: number,
  b: number,
  size = 64,
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = 255;
  }
  return data;
}

export function isPlausibleArtworkDimensions(
  width: number,
  height: number,
  payloadBytesApprox: number,
): boolean {
  const minSide = Math.min(width, height);
  const maxSide = Math.max(width, height);
  if (minSide < 120) return false;
  if (maxSide <= 128 && payloadBytesApprox < 20_000) return false;
  if (width === height && width <= 96) return false;
  return true;
}

/** Reject favicons and tiny SMTC placeholders before palette extraction. */
export function isLikelyValidArtworkDataUrl(dataUrl: string): boolean {
  if (dataUrl.length < 4096) return false;
  const base64 = dataUrl.includes(",") ? dataUrl.split(",")[1] ?? "" : dataUrl;
  const approxBytes = Math.floor((base64.length * 3) / 4);
  if (approxBytes < 4096) return false;
  return true;
}
