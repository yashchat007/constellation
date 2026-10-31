import { describe, expect, it } from "vitest";
import {
  activePhraseFontPx,
  viewportLyricMultiplier,
} from "./typography";

describe("viewportLyricMultiplier", () => {
  it("scales up on larger viewports", () => {
    const small = viewportLyricMultiplier(720, 480, 1.32);
    const large = viewportLyricMultiplier(1400, 900, 1.32);
    expect(large).toBeGreaterThan(small);
  });

  it("targets readable active phrase size on desktop", () => {
    const mul = viewportLyricMultiplier(1200, 800, 1.32);
    const px = activePhraseFontPx(mul);
    expect(px).toBeGreaterThanOrEqual(24);
    expect(px).toBeLessThanOrEqual(48);
  });
});
