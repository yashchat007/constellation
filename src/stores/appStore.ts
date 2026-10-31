import { create } from "zustand";
import type { SongPalette } from "../constellation/palette";
import { DEFAULT_PALETTE } from "../constellation/palette";
import { schedulePersistSettings } from "../settings/persistSettings";
import type {
  AppSettings,
  ConstellationGraph,
  LyricsResult,
  NowPlaying,
} from "../types";
import { defaultSettings } from "../types";

interface AppState {
  nowPlaying: NowPlaying | null;
  lyrics: LyricsResult | null;
  lyricsError: string | null;
  lyricsLoading: boolean;
  lyricsRetryNonce: number;
  graph: ConstellationGraph | null;
  resolvedPalette: SongPalette;
  settings: AppSettings;
  settingsOpen: boolean;
  settingsHydrated: boolean;
  audioCaptureActive: boolean;
  setNowPlaying: (value: NowPlaying | null) => void;
  setLyrics: (value: LyricsResult | null) => void;
  setLyricsError: (value: string | null) => void;
  setLyricsLoading: (value: boolean) => void;
  setGraph: (value: ConstellationGraph | null) => void;
  setResolvedPalette: (value: SongPalette) => void;
  bumpLyricsRetry: () => void;
  hydrateSettings: (value: AppSettings) => void;
  patchSettings: (patch: Partial<AppSettings>) => void;
  setSettingsOpen: (open: boolean) => void;
  setAudioCaptureActive: (active: boolean) => void;
}

export const useAppStore = create<AppState>((set) => ({
  nowPlaying: null,
  lyrics: null,
  lyricsError: null,
  lyricsLoading: false,
  lyricsRetryNonce: 0,
  graph: null,
  resolvedPalette: DEFAULT_PALETTE,
  settings: defaultSettings,
  settingsOpen: false,
  settingsHydrated: false,
  audioCaptureActive: false,
  setNowPlaying: (nowPlaying) => set({ nowPlaying }),
  setLyrics: (lyrics) => set({ lyrics }),
  setLyricsError: (lyricsError) => set({ lyricsError }),
  setLyricsLoading: (lyricsLoading) => set({ lyricsLoading }),
  setGraph: (graph) => set({ graph }),
  setResolvedPalette: (resolvedPalette) => set({ resolvedPalette }),
  bumpLyricsRetry: () =>
    set((s) => ({ lyricsRetryNonce: s.lyricsRetryNonce + 1 })),
  hydrateSettings: (settings) =>
    set({ settings, settingsHydrated: true }),
  patchSettings: (patch) =>
    set((state) => {
      const settings = { ...state.settings, ...patch };
      schedulePersistSettings(settings);
      return { settings };
    }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setAudioCaptureActive: (audioCaptureActive) => set({ audioCaptureActive }),
}));
