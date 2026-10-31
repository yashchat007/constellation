import { describe, expect, it } from "vitest";
import { contrastOnDarkBackground } from "./palette";
import { phraseTargetOpacity } from "./renderer";

describe("phraseTargetOpacity", () => {
  it("ramps readability for nearby lines", () => {
    expect(phraseTargetOpacity(5, 5)).toBe(1);
    expect(phraseTargetOpacity(4, 5)).toBeGreaterThan(0.7);
    expect(phraseTargetOpacity(6, 5)).toBeGreaterThan(0.7);
    expect(phraseTargetOpacity(0, 5)).toBeLessThan(0.45);
  });
});

describe("lyric readability", () => {
  it("keeps active phrase text high-contrast on black", () => {
    const text = "#F5F0E8";
    expect(contrastOnDarkBackground(text)).toBeGreaterThan(0.82);
  });
});
