import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyMoodFallbackPalette,
  applyThemeTargetForTests,
  getDisplayPalette,
  getThemeDiagnostics,
  isThemeTransitionActive,
  onTrackArtworkChange,
  peekTransitionFromPrimaryForTests,
  resetThemeEngineForTests,
} from "./themeEngine";
import { NEUTRAL_FALLBACK_PALETTE } from "./palette";

function paletteWithPrimary(primary: string) {
  return { ...NEUTRAL_FALLBACK_PALETTE, primary, highlight: primary };
}

describe("themeEngine transitions", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetThemeEngineForTests();
  });

  it("blends over ~2s", () => {
    let now = 10_000;
    vi.spyOn(performance, "now").mockImplementation(() => now);

    resetThemeEngineForTests();
    applyThemeTargetForTests(paletteWithPrimary("#cc2244"));
    expect(peekTransitionFromPrimaryForTests().toLowerCase()).toBe(
      NEUTRAL_FALLBACK_PALETTE.primary.toLowerCase(),
    );

    expect(isThemeTransitionActive()).toBe(true);
    const start = getDisplayPalette(now);
    expect(getThemeDiagnostics().transitionProgress).toBe(0);
    expect(start.primary.toLowerCase()).toBe(
      NEUTRAL_FALLBACK_PALETTE.primary.toLowerCase(),
    );

    now += 1000;
    const mid = getDisplayPalette(now);
    expect(mid.primary).not.toBe(start.primary);
    expect(mid.primary).not.toBe("#cc2244");

    now += 1200;
    const end = getDisplayPalette(now);
    expect(end.primary.toLowerCase()).toBe("#cc2244");
    expect(isThemeTransitionActive()).toBe(false);
  });

  it("retargets from intermediate colours when track changes mid-transition", () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);

    resetThemeEngineForTests();
    applyThemeTargetForTests(paletteWithPrimary("#aa0000"));
    now += 500;
    const mid = getDisplayPalette(now);

    applyThemeTargetForTests(paletteWithPrimary("#0044aa"));
    now += 500;
    const blended = getDisplayPalette(now);
    expect(blended.primary).not.toBe(mid.primary);
    expect(blended.primary).not.toBe("#0044aa");

    now += 2500;
    const done = getDisplayPalette(now);
    expect(done.primary.toLowerCase()).toBe("#0044aa");
  });

  it("applies mood fallback when artwork is missing", () => {
    resetThemeEngineForTests();
    onTrackArtworkChange("track-a", null, true, "#ffffff");
    applyMoodFallbackPalette("dreamy", "track-a");
    const d = getThemeDiagnostics();
    expect(d.source).toBe("mood");
    expect(getDisplayPalette().primary).not.toBe(
      NEUTRAL_FALLBACK_PALETTE.primary,
    );
  });

  it("seeds track identity immediately on track change", () => {
    resetThemeEngineForTests();
    onTrackArtworkChange("artist|song-a|100", null, true, "#fff");
    const a = getDisplayPalette().primary;
    onTrackArtworkChange("artist|song-b|100", null, true, "#fff");
    const b = getDisplayPalette().primary;
    expect(a).not.toBe(b);
    expect(getThemeDiagnostics().source).toBe("track");
  });
});
