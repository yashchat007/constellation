import { ThemeAccentVars } from "./components/ThemeAccentVars";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { DevDiagnosticsPanel } from "./components/DevDiagnosticsPanel";
import { ConstellationVisualizer } from "./components/ConstellationVisualizer";
import { LyricsPreview } from "./components/LyricsPreview";
import { MiniPlayer } from "./components/MiniPlayer";
import {
  LyricsStatus,
  SettingsBootstrap,
  SettingsPanel,
} from "./components/SettingsPanel";
import { useAlbumTheme } from "./hooks/useAlbumTheme";
import { useAudioReactiveEngine } from "./hooks/useAudioReactive";
import { useLyricsLoader } from "./hooks/useLyrics";
import { useNowPlayingPoller } from "./hooks/useNowPlaying";
import { useAppStore } from "./stores/appStore";
import "./App.css";

function App() {
  useNowPlayingPoller();
  useLyricsLoader();
  useAlbumTheme();
  useAudioReactiveEngine();

  const showLyrics = useAppStore((s) => s.settings.showConstellation);
  const expanded = useAppStore((s) => s.settings.expandedPanel);
  const viewMode = useAppStore((s) => s.settings.lyricsViewMode);

  return (
    <div className="app-shell">
      <ThemeAccentVars />
      <SettingsBootstrap />
      <MiniPlayer />
      <LyricsStatus />
      {showLyrics && expanded && (
        <main className="app-main">
          <ErrorBoundary name="lyrics-view">
            {viewMode === "traditional" ? (
              <LyricsPreview />
            ) : (
              <ConstellationVisualizer />
            )}
          </ErrorBoundary>
        </main>
      )}
      <SettingsPanel />
      <DevDiagnosticsPanel />
    </div>
  );
}

export default App;
