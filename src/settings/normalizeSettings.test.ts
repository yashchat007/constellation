import { describe, expect, it } from "vitest";
import { normalizeAppSettings } from "./normalizeSettings";

describe("normalizeAppSettings", () => {
  it("applies user defaults when file is missing", () => {
    const s = normalizeAppSettings(null);
    expect(s.lyricOffsetMs).toBe(0);
    expect(s.textSize).toBeGreaterThan(1.2);
    expect(s.autoTint).toBe(true);
    expect(s.audioCaptureEnabled).toBe(true);
  });

  it("preserves saved user fields across restart", () => {
    const s = normalizeAppSettings({
      lyricOffsetMs: 250,
      textSize: 1.5,
      alwaysOnTop: true,
      showConstellation: false,
      expandedPanel: false,
      lyricsViewMode: "traditional",
    });
    expect(s.lyricOffsetMs).toBe(250);
    expect(s.textSize).toBe(1.5);
    expect(s.alwaysOnTop).toBe(true);
    expect(s.showConstellation).toBe(false);
    expect(s.lyricsViewMode).toBe("traditional");
  });

  it("does not restore removed UI tuning from old files", () => {
    const s = normalizeAppSettings({
      lyricOffsetMs: 100,
      audioSensitivity: 1.9,
      autoTint: false,
      themeTransitionMs: 4000,
    });
    expect(s.lyricOffsetMs).toBe(100);
    expect(s.audioSensitivity).toBe(1);
    expect(s.autoTint).toBe(true);
    expect(s.themeTransitionMs).toBe(1750);
  });

  it("migrates invalid lyrics view mode", () => {
    expect(
      normalizeAppSettings({ lyricsViewMode: "invalid" as "constellation" })
        .lyricsViewMode,
    ).toBe("constellation");
  });
});
