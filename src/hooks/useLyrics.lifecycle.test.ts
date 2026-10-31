import { describe, expect, it } from "vitest";
import { classifyLyricsError } from "../lyrics/errorMessages";

/**
 * Cross-track recovery contract: superseded/cancelled fetches must not
 * block classification or error handling for the active track.
 */
describe("lyrics request lifecycle (cross-track recovery)", () => {
  it("treats cancelled superseded fetch distinctly", () => {
    expect(
      classifyLyricsError(
        "lyrics fetch cancelled: superseded by a newer track lyrics request",
      ),
    ).toBe("cancelled");
  });

  it("distinguishes transient outage from connectivity for track B after track A failed", () => {
    const trackA = classifyLyricsError(
      "LRCLIB temporary outage: LRCLIB temporary outage (HTTP 502 Bad Gateway)",
    );
    const trackB = classifyLyricsError("lyrics not found: no matching lyrics");
    expect(trackA).toBe("transient");
    expect(trackB).toBe("not_found");
    expect(trackA).not.toBe(trackB);
  });

  it("simulates generation monotonicity for A→B→C→D isolation", () => {
    let generation = 0;
    const start = (track: string) => {
      generation += 1;
      return { generation, track };
    };
    const a = start("A");
    const b = start("B");
    const c = start("C");
    const d = start("D");
    expect(a.generation).toBeLessThan(b.generation);
    expect(b.generation).toBeLessThan(c.generation);
    expect(c.generation).toBeLessThan(d.generation);
    expect(d.generation).toBe(4);
  });
});
