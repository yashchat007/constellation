import { describe, expect, it } from "vitest";
import {
  blendPalettes,
  buildSongPaletteFromPixelData,
  buildSongPaletteFromSwatches,
  CONSTELLATION_CANVAS_BG,
  contrastOnDarkBackground,
  isLikelyValidArtworkDataUrl,
  isPlausibleArtworkDimensions,
  isRedFamilyHue,
  lerpOklabHex,
  moodPaletteForCategory,
  NEUTRAL_FALLBACK_PALETTE,
  paletteHueDegrees,
  selectDiverseSwatches,
  solidColorPixelGrid,
  trackIdentityPalette,
} from "./palette";

describe("selectDiverseSwatches", () => {
  it("picks perceptually distinct colours", () => {
    const buckets = [
      { r: 200, g: 40, b: 40, weight: 100 },
      { r: 195, g: 45, b: 42, weight: 90 },
      { r: 40, g: 80, b: 200, weight: 80 },
      { r: 180, g: 160, b: 50, weight: 70 },
    ];
    const picked = selectDiverseSwatches(buckets, 3);
    expect(picked).toHaveLength(3);
    expect(picked[0].r).toBeGreaterThan(150);
    const hasBlue = picked.some((s) => s.b > s.r + 30);
    expect(hasBlue).toBe(true);
  });
});

describe("buildSongPaletteFromSwatches", () => {
  it("produces readable contrast on dark background", () => {
    const warm = buildSongPaletteFromSwatches([180, 90, 60], [90, 120, 180], [200, 180, 140]);
    const cool = buildSongPaletteFromSwatches([60, 120, 200], [140, 60, 160], [100, 180, 160]);
    expect(warm.primary).not.toBe(cool.primary);
    expect(contrastOnDarkBackground(warm.highlight)).toBeGreaterThan(0.55);
    expect(contrastOnDarkBackground(warm.text)).toBeGreaterThan(0.6);
  });

  it("separates red vs blue artwork swatches", () => {
    const red = buildSongPaletteFromSwatches([210, 40, 50], [120, 30, 40], [180, 80, 70]);
    const blue = buildSongPaletteFromSwatches([40, 80, 210], [30, 60, 140], [70, 120, 200]);
    expect(red.primary).not.toBe(blue.primary);
    expect(red.backgroundTint).toBe(CONSTELLATION_CANVAS_BG);
    expect(blue.backgroundTint).toBe(CONSTELLATION_CANVAS_BG);
  });

  it("keeps canvas background black regardless of swatches", () => {
    const palette = buildSongPaletteFromSwatches([210, 40, 50], [40, 80, 210], [180, 60, 160]);
    expect(palette.backgroundTint).toBe(CONSTELLATION_CANVAS_BG);
  });
});

describe("artwork pixel extraction", () => {
  it("maps red-dominant pixels to red-family accents", () => {
    const palette = buildSongPaletteFromPixelData(solidColorPixelGrid(210, 42, 48));
    expect(isRedFamilyHue(paletteHueDegrees(palette.primary))).toBe(true);
  });

  it("maps purple-dominant pixels to purple-family accents", () => {
    const palette = buildSongPaletteFromPixelData(solidColorPixelGrid(140, 52, 210));
    const hex = palette.primary.replace("#", "");
    const r = parseInt(hex.slice(0, 2), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    expect(b).toBeGreaterThan(r + 12);
  });

  it("separates red vs purple artwork palettes", () => {
    const red = buildSongPaletteFromPixelData(solidColorPixelGrid(220, 38, 52));
    const purple = buildSongPaletteFromPixelData(solidColorPixelGrid(150, 60, 220));
    expect(red.primary).not.toBe(purple.primary);
  });
});

describe("track identity fallback", () => {
  it("derives stable palettes per track key", () => {
    const a = trackIdentityPalette("weeknd|die for you|240000");
    const b = trackIdentityPalette("weeknd|die for you|240000");
    const c = trackIdentityPalette("swift|blank space|231000");
    expect(a.primary).toBe(b.primary);
    expect(a.primary).not.toBe(c.primary);
  });
});

describe("blendPalettes", () => {
  it("returns source palette at t=0", () => {
    const a = { ...NEUTRAL_FALLBACK_PALETTE, primary: "#B8B0A8" };
    const b = { ...NEUTRAL_FALLBACK_PALETTE, primary: "#cc2244" };
    expect(lerpOklabHex(a.primary, b.primary, 0).toLowerCase()).toBe("#b8b0a8");
    expect(blendPalettes(a, b, 0).primary.toLowerCase()).toBe("#b8b0a8");
  });

  it("interpolates perceptually at midpoint", () => {
    const a = { ...NEUTRAL_FALLBACK_PALETTE, primary: "#ff0000" };
    const b = { ...NEUTRAL_FALLBACK_PALETTE, primary: "#0000ff" };
    const mid = blendPalettes(a, b, 0.5);
    expect(mid.primary).not.toBe(a.primary);
    expect(mid.primary).not.toBe(b.primary);
    expect(lerpOklabHex(a.primary, b.primary, 0.5)).toBe(mid.primary);
  });
});

describe("moodPaletteForCategory", () => {
  it("produces distinct palettes per mood", () => {
    const dreamy = moodPaletteForCategory("dreamy");
    const energetic = moodPaletteForCategory("energetic");
    const romantic = moodPaletteForCategory("romantic");
    expect(dreamy.primary).not.toBe(energetic.primary);
    expect(romantic.primary).not.toBe(dreamy.primary);
    expect(dreamy.primary.toLowerCase()).not.toMatch(/e5bd|f5d7/);
  });

  it("derives unique neutral palettes from track keys", () => {
    const a = moodPaletteForCategory("neutral", "artist|title|180000");
    const b = moodPaletteForCategory("neutral", "artist|other|180000");
    expect(a.primary).not.toBe(b.primary);
  });
});

describe("artwork validation", () => {
  it("rejects tiny data urls", () => {
    expect(isLikelyValidArtworkDataUrl("data:image/png;base64,abc")).toBe(false);
  });

  it("rejects favicon-sized dimensions", () => {
    expect(isPlausibleArtworkDimensions(64, 64, 5000)).toBe(false);
    expect(isPlausibleArtworkDimensions(300, 300, 50000)).toBe(true);
  });
});

describe("missing artwork fallback", () => {
  it("neutral fallback is not gold-tinted", () => {
    expect(NEUTRAL_FALLBACK_PALETTE.primary.toLowerCase()).not.toMatch(/e5bd|f5d7|gold/i);
  });
});
