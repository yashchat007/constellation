import { describe, expect, it } from "vitest";
import { trackIdentity } from "./useLyrics";
import type { NowPlaying } from "../types";

describe("trackIdentity", () => {
  it("uses trackKey when present", () => {
    const np: NowPlaying = {
      title: "A",
      artist: "B",
      trackKey: "key-1",
      status: "playing",
      positionMs: 0,
      durationMs: null,
      album: null,
      artworkDataUrl: null,
    };
    expect(trackIdentity(np)).toBe("key-1");
  });

  it("changes when title changes", () => {
    const a: NowPlaying = {
      title: "Song A",
      artist: "Artist",
      trackKey: "artist::song a",
      status: "playing",
      positionMs: 0,
      durationMs: null,
      album: null,
      artworkDataUrl: null,
    };
    const b = { ...a, title: "Song B", trackKey: "artist::song b" };
    expect(trackIdentity(a)).not.toBe(trackIdentity(b));
  });
});
