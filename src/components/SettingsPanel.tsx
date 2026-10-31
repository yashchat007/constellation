import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "@tauri-apps/api/core";
import { importLrcFile } from "../hooks/useLyrics";
import {
  getPersistStatus,
  loadSettingsFromDisk,
  markSettingsHydrated,
  subscribePersistStatus,
} from "../settings/persistSettings";
import { useAppStore } from "../stores/appStore";

export function SettingsPanel() {
  const open = useAppStore((s) => s.settingsOpen);
  const settings = useAppStore((s) => s.settings);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
  const patchSettings = useAppStore((s) => s.patchSettings);
  const [persistStatus, setPersistStatus] = useState(getPersistStatus());

  useEffect(() => subscribePersistStatus(setPersistStatus), []);

  useEffect(() => {
    if (!isTauri()) return;
    getCurrentWindow().setAlwaysOnTop(settings.alwaysOnTop).catch(() => {});
  }, [settings.alwaysOnTop]);

  if (!open) {
    return null;
  }

  return (
    <div className="settings-backdrop" onClick={() => setSettingsOpen(false)}>
      <aside
        className="settings-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <h2>Settings</h2>
        <p className="settings-hint">
          Changes save automatically. Colours and motion adapt to each song.
        </p>

        <label>
          Lyric sync offset
          <input
            type="range"
            min={-3000}
            max={3000}
            step={50}
            value={settings.lyricOffsetMs}
            onChange={(e) =>
              patchSettings({ lyricOffsetMs: Number(e.target.value) })
            }
          />
          <span>{settings.lyricOffsetMs} ms</span>
        </label>

        <label>
          Lyric size
          <input
            type="range"
            min={0.85}
            max={1.75}
            step={0.05}
            value={settings.textSize}
            onChange={(e) =>
              patchSettings({ textSize: Number(e.target.value) })
            }
          />
        </label>

        <label className="checkbox">
          <input
            type="checkbox"
            checked={settings.alwaysOnTop}
            onChange={(e) =>
              patchSettings({ alwaysOnTop: e.target.checked })
            }
          />
          Always on top
        </label>

        <label className="checkbox">
          <input
            type="checkbox"
            checked={settings.expandedPanel}
            onChange={(e) =>
              patchSettings({ expandedPanel: e.target.checked })
            }
          />
          Expanded lyrics panel
        </label>

        <div className="settings-actions">
          <button type="button" onClick={() => importLrcFile()}>
            Import .lrc
          </button>
          <button type="button" className="primary" onClick={() => setSettingsOpen(false)}>
            Done
          </button>
        </div>

        {persistStatus === "saving" && (
          <p className="settings-save-status">Saving…</p>
        )}
        {persistStatus === "saved" && (
          <p className="settings-save-status">Saved</p>
        )}
        {persistStatus === "error" && (
          <p className="settings-save-status settings-save-error">
            Could not save settings
          </p>
        )}
      </aside>
    </div>
  );
}

export function SettingsBootstrap() {
  const hydrateSettings = useAppStore((s) => s.hydrateSettings);

  useEffect(() => {
    let cancelled = false;
    void loadSettingsFromDisk().then((loaded) => {
      if (cancelled) {
        return;
      }
      hydrateSettings(loaded);
      markSettingsHydrated();
      if (isTauri()) {
        getCurrentWindow().setAlwaysOnTop(loaded.alwaysOnTop).catch(() => {});
      }
    });
    return () => {
      cancelled = true;
    };
  }, [hydrateSettings]);

  return null;
}

export function LyricsStatus() {
  const error = useAppStore((s) => s.lyricsError);
  const loading = useAppStore((s) => s.lyricsLoading);
  const nowPlaying = useAppStore((s) => s.nowPlaying);
  const bumpLyricsRetry = useAppStore((s) => s.bumpLyricsRetry);
  if (loading && nowPlaying?.title) {
    return (
      <div className="lyrics-status lyrics-status-loading">
        Loading lyrics for {nowPlaying.title}…
      </div>
    );
  }
  if (!error) return null;
  const retryable = !/not found|no matching/i.test(error);
  return (
    <div className="lyrics-status lyrics-status-warn">
      <span>{error}</span>
      {retryable && (
        <button
          type="button"
          className="pill ghost lyrics-retry"
          onClick={() => bumpLyricsRetry()}
        >
          Retry lyrics
        </button>
      )}
    </div>
  );
}
