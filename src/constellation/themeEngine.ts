import {
  artworkCacheKey,
  blendPalettes,
  extractPaletteFromDataUrl,
  isLikelyValidArtworkDataUrl,
  manualPaletteFromAccent,
  moodPaletteForCategory,
  NEUTRAL_FALLBACK_PALETTE,
  trackIdentityPalette,
  type SongPalette,
} from "./palette";
import type { MoodCategory } from "./mood/types";

export interface ThemeDiagnostics {
  trackKey: string | null;
  artworkId: string | null;
  source: "artwork" | "manual" | "fallback" | "preserved" | "mood" | "track";
  targetPrimary: string;
  displayPrimary: string;
  displayHighlight: string;
  displayNode: string;
  backgroundTint: string;
  transitionProgress: number;
  dominantPreview: string[];
}

let displayPalette: SongPalette = { ...NEUTRAL_FALLBACK_PALETTE };
let targetPalette: SongPalette = { ...NEUTRAL_FALLBACK_PALETTE };
let transitionFrom: SongPalette = { ...NEUTRAL_FALLBACK_PALETTE };
let transitionStart = 0;
let transitionDurationMs = 1750;
let transitionActive = false;

let currentTrackKey: string | null = null;
let currentArtworkId: string | null = null;
let currentMoodCategory: MoodCategory | null = null;
let artworkPaletteLocked = false;
let loadGeneration = 0;

const diag: ThemeDiagnostics = {
  trackKey: null,
  artworkId: null,
  source: "fallback",
  targetPrimary: NEUTRAL_FALLBACK_PALETTE.primary,
  displayPrimary: NEUTRAL_FALLBACK_PALETTE.primary,
  displayHighlight: NEUTRAL_FALLBACK_PALETTE.highlight,
  displayNode: NEUTRAL_FALLBACK_PALETTE.node,
  backgroundTint: NEUTRAL_FALLBACK_PALETTE.backgroundTint,
  transitionProgress: 1,
  dominantPreview: [],
};

export function getDisplayPalette(nowMs = performance.now()): SongPalette {
  if (transitionActive) {
    const t = Math.min(
      1,
      (nowMs - transitionStart) / Math.max(400, transitionDurationMs),
    );
    displayPalette = blendPalettes(transitionFrom, targetPalette, t);
    diag.transitionProgress = t;
    diag.displayPrimary = displayPalette.primary;
    diag.displayHighlight = displayPalette.highlight;
    diag.displayNode = displayPalette.node;
    diag.backgroundTint = displayPalette.backgroundTint;
    if (t >= 1) {
      transitionActive = false;
    }
  }
  return displayPalette;
}

export function getThemeDiagnostics(): ThemeDiagnostics {
  return { ...diag, displayPrimary: displayPalette.primary };
}

export function isArtworkPaletteLocked(): boolean {
  return artworkPaletteLocked;
}

function beginTransition(to: SongPalette, source: ThemeDiagnostics["source"]) {
  transitionFrom = { ...displayPalette };
  targetPalette = to;
  transitionStart = performance.now();
  transitionActive = true;
  diag.source = source;
  diag.targetPrimary = to.primary;
  diag.dominantPreview = [to.primary, to.secondary, to.highlight];
  diag.displayHighlight = displayPalette.highlight;
  diag.displayNode = displayPalette.node;
  diag.backgroundTint = displayPalette.backgroundTint;
}

export function setThemeTransitionDuration(ms: number) {
  transitionDurationMs = Math.max(400, Math.min(4000, ms));
}

export function applyManualTheme(accent: string) {
  const manual = manualPaletteFromAccent(accent);
  artworkPaletteLocked = false;
  beginTransition(manual, "manual");
  currentTrackKey = null;
  currentArtworkId = null;
  diag.trackKey = null;
  diag.artworkId = null;
}

export function applyTrackIdentityPalette(trackKey: string) {
  if (!trackKey) {
    return;
  }
  beginTransition(trackIdentityPalette(trackKey), "track");
}

export function applyMoodFallbackPalette(
  category: MoodCategory,
  trackKey: string | null,
) {
  if (!trackKey || artworkPaletteLocked) {
    return;
  }
  if (category === currentMoodCategory && currentTrackKey === trackKey) {
    return;
  }
  currentMoodCategory = category;
  beginTransition(moodPaletteForCategory(category, trackKey), "mood");
}

export function onTrackArtworkChange(
  trackKey: string | null,
  artworkDataUrl: string | null,
  autoTint: boolean,
  manualAccent: string,
) {
  if (!autoTint) {
    applyManualTheme(manualAccent);
    return;
  }

  if (!trackKey) {
    return;
  }

  if (trackKey !== currentTrackKey) {
    currentTrackKey = trackKey;
    currentArtworkId = null;
    currentMoodCategory = null;
    artworkPaletteLocked = false;
    loadGeneration += 1;
    diag.trackKey = trackKey;
    applyTrackIdentityPalette(trackKey);
  }

  if (!artworkDataUrl || !isLikelyValidArtworkDataUrl(artworkDataUrl)) {
    return;
  }

  const artId = artworkCacheKey(trackKey, artworkDataUrl);
  if (artId === currentArtworkId && artworkPaletteLocked) {
    return;
  }

  const gen = ++loadGeneration;
  currentArtworkId = artId;
  diag.artworkId = artId.slice(0, 12);

  extractPaletteFromDataUrl(trackKey, artworkDataUrl).then((palette) => {
    if (gen !== loadGeneration || trackKey !== currentTrackKey) {
      return;
    }
    if (!palette) {
      currentArtworkId = null;
      artworkPaletteLocked = false;
      return;
    }
    artworkPaletteLocked = true;
    currentMoodCategory = null;
    beginTransition(palette, "artwork");
  });
}

export function peekTransitionFromPrimaryForTests(): string {
  return transitionFrom.primary;
}

export function resetThemeEngineForTests() {
  displayPalette = { ...NEUTRAL_FALLBACK_PALETTE };
  targetPalette = { ...NEUTRAL_FALLBACK_PALETTE };
  transitionFrom = { ...NEUTRAL_FALLBACK_PALETTE };
  transitionActive = false;
  currentTrackKey = null;
  currentArtworkId = null;
  currentMoodCategory = null;
  artworkPaletteLocked = false;
  loadGeneration = 0;
  diag.transitionProgress = 1;
}

export function isThemeTransitionActive(): boolean {
  return transitionActive;
}

export function applyThemeTargetForTests(palette: SongPalette) {
  beginTransition(palette, "artwork");
}

export function resetThemeEngineFallback() {
  beginTransition(NEUTRAL_FALLBACK_PALETTE, "fallback");
}
