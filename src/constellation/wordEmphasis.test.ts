import { describe, expect, it } from "vitest";
import {
  phraseLevelWordEmphasis,
  updateWordEmphasisLevels,
  wordScaleFromEmphasis,
  wordsHaveReliableSync,
} from "./wordEmphasis";

describe("wordScaleFromEmphasis", () => {
  it("scales between min and max", () => {
    expect(wordScaleFromEmphasis(0)).toBe(1);
    expect(wordScaleFromEmphasis(1)).toBeCloseTo(1.32, 2);
    expect(wordScaleFromEmphasis(0.5)).toBeGreaterThan(1);
    expect(wordScaleFromEmphasis(0.5)).toBeLessThan(1.32);
  });
});

describe("updateWordEmphasisLevels", () => {
  it("raises active word emphasis while playing", () => {
    const next = updateWordEmphasisLevels([0, 0, 0], 3, 1, true, 50);
    expect(next[1]).toBeGreaterThan(next[0]);
    expect(next[1]).toBeGreaterThan(next[2]);
  });

  it("freezes emphasis when paused", () => {
    const levels = [0.2, 0.9, 0.1];
    const next = updateWordEmphasisLevels(levels, 3, 2, false, 50);
    expect(next).toEqual(levels);
  });

  it("relaxes previous word when active index moves", () => {
    let levels = [0, 0, 0];
    for (let i = 0; i < 20; i += 1) {
      levels = updateWordEmphasisLevels(levels, 3, 0, true, 32);
    }
    for (let i = 0; i < 8; i += 1) {
      levels = updateWordEmphasisLevels(levels, 3, 1, true, 32);
    }
    expect(levels[0]).toBeLessThan(levels[1]);
  });
});

describe("phraseLevelWordEmphasis", () => {
  it("uniform emphasis when line is active", () => {
    expect(phraseLevelWordEmphasis(4, true)).toEqual([0.55, 0.55, 0.55, 0.55]);
  });

  it("zeros when line inactive", () => {
    expect(phraseLevelWordEmphasis(2, false)).toEqual([0, 0]);
  });
});

describe("wordsHaveReliableSync", () => {
  it("false when all estimated", () => {
    expect(
      wordsHaveReliableSync([
        { estimated: true },
        { estimated: true },
      ]),
    ).toBe(false);
  });

  it("true when any word is synced", () => {
    expect(
      wordsHaveReliableSync([
        { estimated: true },
        { estimated: false },
      ]),
    ).toBe(true);
  });
});
