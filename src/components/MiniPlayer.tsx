import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  mediaNext,
  mediaPlayPause,
  mediaPrevious,
} from "../hooks/useNowPlaying";
import { useAppStore } from "../stores/appStore";

export function MiniPlayer() {
  const nowPlaying = useAppStore((s) => s.nowPlaying);
  const settings = useAppStore((s) => s.settings);
  const patchSettings = useAppStore((s) => s.patchSettings);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
  const audioCaptureActive = useAppStore((s) => s.audioCaptureActive);

  const title = nowPlaying?.title?.trim();
  const hasTrack = Boolean(title);
  const displayTitle = title || "Nothing playing";
  const displayArtist =
    nowPlaying?.artist?.trim() ||
    (hasTrack ? "Playing from another app" : "Start music in Spotify, browser, or any app");
  const playing = nowPlaying?.status === "playing";
  const paused = nowPlaying?.status === "paused";
  const stopped = nowPlaying?.status === "stopped" || nowPlaying?.status === "none";

  return (
    <header
      className="mini-player"
      data-tauri-drag-region
      onDoubleClick={() => getCurrentWindow().toggleMaximize()}
    >
      <div className="art-wrap">
        {nowPlaying?.artworkDataUrl ? (
          <img
            key={nowPlaying.trackKey ?? nowPlaying.title}
            src={nowPlaying.artworkDataUrl}
            alt=""
            className="art"
          />
        ) : (
          <div className="art art-placeholder" />
        )}
      </div>

      <div className="meta">
        <div className="title">{displayTitle}</div>
        <div className="artist">{displayArtist}</div>
        {(paused || stopped) && hasTrack && (
          <span className="playback-badge">
            {paused ? "Paused" : "Stopped"}
          </span>
        )}
        {audioCaptureActive && (
          <span className="playback-badge audio-live">Audio reactive</span>
        )}
        <div className="meta-actions">
          <button
            type="button"
            className={settings.showConstellation ? "pill active" : "pill"}
            onClick={() =>
              patchSettings({ showConstellation: !settings.showConstellation })
            }
          >
            Lyrics
          </button>
          {settings.showConstellation && (
            <button
              type="button"
              className="pill ghost"
              onClick={() =>
                patchSettings({
                  lyricsViewMode:
                    settings.lyricsViewMode === "constellation"
                      ? "traditional"
                      : "constellation",
                })
              }
            >
              {settings.lyricsViewMode === "constellation"
                ? "Classic view"
                : "Constellation"}
            </button>
          )}
          <button
            type="button"
            className="pill ghost"
            onClick={() => setSettingsOpen(true)}
          >
            Settings
          </button>
        </div>
      </div>

      <div className="transport">
        <button type="button" aria-label="Previous" onClick={() => mediaPrevious()}>
          ‹‹
        </button>
        <button
          type="button"
          className="play"
          aria-label={playing ? "Pause" : "Play"}
          onClick={() => mediaPlayPause()}
        >
          {playing ? "❚❚" : "▶"}
        </button>
        <button type="button" aria-label="Next" onClick={() => mediaNext()}>
          ››
        </button>
      </div>
    </header>
  );
}
