import { describe, expect, it } from "vitest";
import {
  containsDevanagari,
  isMostlyRomanDisplay,
  longWordScaleHint,
} from "./romanizeDisplay";

describe("romanizeDisplay helpers", () => {
  it("detects Devanagari script", () => {
    expect(containsDevanagari("तुम")).toBe(true);
    expect(containsDevanagari("Tum hi ho")).toBe(false);
  });

  it("treats roman lyrics as display-ready", () => {
    expect(isMostlyRomanDisplay("Kabhi jo baadal barse")).toBe(true);
  });

  it("shrinks layout hint for very long romanized words", () => {
    expect(longWordScaleHint("short")).toBe(1);
    expect(longWordScaleHint("bahutlambaakshar")).toBeLessThan(1);
  });
});
