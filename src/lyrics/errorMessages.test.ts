import { describe, expect, it } from "vitest";
import { classifyLyricsError, formatLyricsError } from "./errorMessages";

describe("lyrics error messages", () => {
  it("classifies HTTP 400 as rejected", () => {
    expect(
      classifyLyricsError("lyrics not found: LRCLIB get rejected query (400 bad request)"),
    ).toBe("not_found");
  });

  it("classifies 503 and retry exhaustion as transient", () => {
    expect(classifyLyricsError("LRCLIB temporary outage (HTTP 503)")).toBe(
      "transient",
    );
    expect(
      classifyLyricsError(
        "LRCLIB GET failed after retries (service may be unavailable)",
      ),
    ).toBe("transient");
  });

  it("classifies connection errors separately from transient outage", () => {
    expect(classifyLyricsError("connection error: dns error")).toBe(
      "connectivity",
    );
  });

  it("classifies in-progress duplicate fetch as busy", () => {
    expect(
      classifyLyricsError("lyrics fetch busy: Lyrics fetch already in progress for this track"),
    ).toBe("busy");
  });

  it("classifies frontend timeout as timeout not generic network", () => {
    const f = formatLyricsError(
      new Error("Lyrics request timed out. Try Retry lyrics."),
    );
    expect(f.kind).toBe("timeout");
    expect(f.message).not.toContain("Check your connection");
  });

  it("formats not found distinctly from transient", () => {
    const nf = formatLyricsError("lyrics not found: no match");
    const tr = formatLyricsError("LRCLIB temporary outage (HTTP 502)");
    expect(nf.kind).toBe("not_found");
    expect(tr.kind).toBe("transient");
    expect(tr.message).not.toContain("Check your connection");
  });

  it("classifies parse errors", () => {
    expect(
      classifyLyricsError("parse error: LRCLIB GET response parse error: expected value"),
    ).toBe("parse");
  });
});
