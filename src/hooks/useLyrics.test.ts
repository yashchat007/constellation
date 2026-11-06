import { describe, expect, it } from "vitest";
import { resolveLyricsFetchAction, trackIdentity } from "./useLyrics";
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

describe("resolveLyricsFetchAction", () => {
  it("failed_track_does_not_block_next_track", () => {
    const trackA = "artist::song a";
    const trackB = "artist::song b";

    expect(
      resolveLyricsFetchAction({
        trackKey: trackA,
        lastLoadedKey: null,
        lyricsRetryNonce: 0,
        lastRetryHandled: 0,
        inFlightKey: null,
        loadedLyricsTrackKey: null,
      }),
    ).toBe("fetch");

    expect(
      resolveLyricsFetchAction({
        trackKey: trackB,
        lastLoadedKey: trackA,
        lyricsRetryNonce: 0,
        lastRetryHandled: 0,
        inFlightKey: null,
        loadedLyricsTrackKey: null,
      }),
    ).toBe("fetch");
  });

  it("refetches when lastLoadedKey matches but lyrics were cleared", () => {
    const key = "artist::song b";
    expect(
      resolveLyricsFetchAction({
        trackKey: key,
        lastLoadedKey: key,
        lyricsRetryNonce: 0,
        lastRetryHandled: 0,
        inFlightKey: null,
        loadedLyricsTrackKey: null,
      }),
    ).toBe("fetch");
  });

  it("skips when lyrics are loaded for the same track", () => {
    const key = "artist::song b";
    expect(
      resolveLyricsFetchAction({
        trackKey: key,
        lastLoadedKey: key,
        lyricsRetryNonce: 0,
        lastRetryHandled: 0,
        inFlightKey: null,
        loadedLyricsTrackKey: key,
      }),
    ).toBe("skip_up_to_date");
  });

  it("skips duplicate in-flight fetch for same track", () => {
    const key = "artist::song b";
    expect(
      resolveLyricsFetchAction({
        trackKey: key,
        lastLoadedKey: null,
        lyricsRetryNonce: 0,
        lastRetryHandled: 0,
        inFlightKey: key,
        loadedLyricsTrackKey: null,
      }),
    ).toBe("skip_in_flight");
  });
});
