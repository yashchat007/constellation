import { useEffect } from "react";
import { getLatestAudioSnapshot } from "../audio/snapshotStore";
import { classifyMoodFromAudio } from "../constellation/mood/classifier";
import { isLikelyValidArtworkDataUrl } from "../constellation/palette";
import {
  applyMoodFallbackPalette,
  getDisplayPalette,
  isArtworkPaletteLocked,
  onTrackArtworkChange,
  setThemeTransitionDuration,
} from "../constellation/themeEngine";
import { useAppStore } from "../stores/appStore";

const MOOD_REEVAL_MS = 2200;

/** Drives song-based palette targets (canvas reads getDisplayPalette each frame). */
export function useAlbumTheme() {
  const nowPlaying = useAppStore((s) => s.nowPlaying);
  const autoTint = useAppStore((s) => s.settings.autoTint);
  const transitionMs = useAppStore((s) => s.settings.themeTransitionMs);
  const manualAccent = useAppStore((s) => s.settings.accentColor);
  const autoMoodAdaptation = useAppStore((s) => s.settings.autoMoodAdaptation);
  const manualMoodOverride = useAppStore((s) => s.settings.manualMoodOverride);
  const audioSensitivity = useAppStore((s) => s.settings.audioSensitivity);
  const motionIntensity = useAppStore((s) => s.settings.audioMotionIntensity);
  const particleIntensity = useAppStore((s) => s.settings.audioParticleIntensity);
  const setResolvedPalette = useAppStore((s) => s.setResolvedPalette);

  useEffect(() => {
    setThemeTransitionDuration(transitionMs);
    onTrackArtworkChange(
      nowPlaying?.trackKey ?? null,
      nowPlaying?.artworkDataUrl ?? null,
      autoTint,
      manualAccent,
    );
    setResolvedPalette(getDisplayPalette());
  }, [
    nowPlaying?.trackKey,
    nowPlaying?.artworkDataUrl,
    autoTint,
    manualAccent,
    transitionMs,
    setResolvedPalette,
  ]);

  useEffect(() => {
    if (!autoTint) {
      return;
    }
    if (isArtworkPaletteLocked()) {
      return;
    }
    const trackKey = nowPlaying?.trackKey ?? null;
    if (!trackKey) {
      return;
    }
    const artUrl = nowPlaying?.artworkDataUrl;
    if (artUrl && isLikelyValidArtworkDataUrl(artUrl)) {
      return;
    }

    const evaluateMood = () => {
      if (isArtworkPaletteLocked()) {
        return;
      }
      const audio = getLatestAudioSnapshot();
      const playing = nowPlaying?.status === "playing";
      const category = classifyMoodFromAudio({
        audio,
        playing,
        paused: nowPlaying?.status === "paused",
        autoMood: autoMoodAdaptation,
        manualMood: manualMoodOverride,
        sensitivity: audioSensitivity,
        motionIntensity,
        particleIntensity,
      });
      applyMoodFallbackPalette(category, trackKey);
      setResolvedPalette(getDisplayPalette());
    };

    evaluateMood();
    const id = window.setInterval(evaluateMood, MOOD_REEVAL_MS);
    return () => window.clearInterval(id);
  }, [
    autoTint,
    autoMoodAdaptation,
    manualMoodOverride,
    audioSensitivity,
    motionIntensity,
    particleIntensity,
    nowPlaying?.trackKey,
    nowPlaying?.artworkDataUrl,
    nowPlaying?.status,
    setResolvedPalette,
  ]);
}
