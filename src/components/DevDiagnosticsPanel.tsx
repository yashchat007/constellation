import { useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  getLatestAudioSnapshot,
  getAudioCaptureStatus,
} from "../audio/snapshotStore";
import { getThemeDiagnostics } from "../constellation/themeEngine";
import { buildMoodProfile, classifyMoodFromAudio } from "../constellation/mood/classifier";
import { useAppStore } from "../stores/appStore";

export function DevDiagnosticsPanel() {
  const [open, setOpen] = useState(() =>
    typeof localStorage !== "undefined"
      ? localStorage.getItem("constellation-dev-diag") === "1"
      : false,
  );
  const [, tick] = useState(0);
  const nowPlaying = useAppStore((s) => s.nowPlaying);
  const settings = useAppStore((s) => s.settings);
  const captureActive = useAppStore((s) => s.audioCaptureActive);
  const [lyricsDiag, setLyricsDiag] = useState<Record<string, unknown> | null>(
    null,
  );

  useEffect(() => {
    if (!import.meta.env.DEV || !isTauri()) {
      return;
    }
    const id = window.setInterval(() => {
      invoke<Record<string, unknown> | null>("get_lyrics_fetch_diagnostics")
        .then(setLyricsDiag)
        .catch(() => {});
    }, 800);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!import.meta.env.DEV) {
      return;
    }
    const id = window.setInterval(() => tick((n) => n + 1), 500);
    return () => window.clearInterval(id);
  }, []);

  if (!import.meta.env.DEV) {
    return null;
  }

  const audio = getLatestAudioSnapshot();
  const status = getAudioCaptureStatus();
  const theme = getThemeDiagnostics();
  const mood = classifyMoodFromAudio({
    audio,
    playing: nowPlaying?.status === "playing",
    paused: nowPlaying?.status === "paused",
    autoMood: settings.autoMoodAdaptation,
    manualMood: settings.manualMoodOverride,
    sensitivity: settings.audioSensitivity,
    motionIntensity: settings.audioMotionIntensity,
    particleIntensity: settings.audioParticleIntensity,
  });
  const profile = buildMoodProfile({
    audio,
    playing: nowPlaying?.status === "playing",
    paused: nowPlaying?.status === "paused",
    autoMood: settings.autoMoodAdaptation,
    manualMood: settings.manualMoodOverride,
    sensitivity: settings.audioSensitivity,
    motionIntensity: settings.audioMotionIntensity,
    particleIntensity: settings.audioParticleIntensity,
  });

  const toggle = () => {
    const next = !open;
    setOpen(next);
    localStorage.setItem("constellation-dev-diag", next ? "1" : "0");
  };

  return (
    <>
      <button type="button" className="dev-diag-toggle" onClick={toggle}>
        Diag
      </button>
      {open && (
        <aside className="dev-diag-panel" aria-label="Development diagnostics">
          <h3>Audio pipeline</h3>
          <dl>
            <dt>Capture</dt>
            <dd>{captureActive || status?.isCapturing ? "Active" : "Inactive"}</dd>
            <dt>Signal</dt>
            <dd>{audio?.isSignalPresent ? "Yes" : "No"}</dd>
            <dt>Sample rate</dt>
            <dd>{status?.sampleRate ?? audio?.sampleRate ?? "—"}</dd>
            <dt>Chunks / samples</dt>
            <dd>
              {status?.chunksReceived ?? 0} / {status?.samplesReceived ?? 0}
            </dd>
            <dt>RMS</dt>
            <dd>{(audio?.rmsEnergy ?? 0).toFixed(4)}</dd>
            <dt>Bass / mid / treble</dt>
            <dd>
              {(audio?.bassEnergy ?? 0).toFixed(2)} /{" "}
              {(audio?.midEnergy ?? 0).toFixed(2)} /{" "}
              {(audio?.trebleEnergy ?? 0).toFixed(2)}
            </dd>
            <dt>Onset</dt>
            <dd>{(audio?.onsetStrength ?? 0).toFixed(2)}</dd>
            <dt>Last audio update</dt>
            <dd>{audio?.timestampMs ?? "—"}</dd>
          </dl>
          <h3>Theme</h3>
          <dl>
            <dt>Track</dt>
            <dd>{nowPlaying?.trackKey ?? "—"}</dd>
            <dt>Artwork id</dt>
            <dd>{theme.artworkId ?? "—"}</dd>
            <dt>Source</dt>
            <dd>{theme.source}</dd>
            <dt>Dominant</dt>
            <dd>{theme.dominantPreview.join(" · ") || "—"}</dd>
            <dt>Display primary</dt>
            <dd>{theme.displayPrimary}</dd>
            <dt>Highlight / node</dt>
            <dd>
              {theme.displayHighlight} · {theme.displayNode}
            </dd>
            <dt>Background tint</dt>
            <dd>{theme.backgroundTint}</dd>
            <dt>Transition</dt>
            <dd>{(theme.transitionProgress * 100).toFixed(0)}%</dd>
            <dt>Mood</dt>
            <dd>{mood}</dd>
            <dt>Motion</dt>
            <dd>{profile.movementSpeed.toFixed(2)}</dd>
          </dl>
          <h3>Lyrics fetch</h3>
          <dl>
            <dt>Normalized</dt>
            <dd>
              {lyricsDiag
                ? `${String(lyricsDiag.normalizedArtist ?? "—")} — ${String(lyricsDiag.normalizedTitle ?? "—")}`
                : "—"}
            </dd>
            <dt>Language</dt>
            <dd>{lyricsDiag ? String(lyricsDiag.languageHint ?? "—") : "—"}</dd>
            <dt>Variants</dt>
            <dd>{lyricsDiag ? String(lyricsDiag.variantCount ?? "—") : "—"}</dd>
            <dt>Last variant</dt>
            <dd>
              {lyricsDiag
                ? `${String(lyricsDiag.lastVariantArtist ?? "")} / ${String(lyricsDiag.lastVariantTitle ?? "")}`
                : "—"}
            </dd>
            <dt>Cache / error</dt>
            <dd>
              {lyricsDiag
                ? `${String(lyricsDiag.cacheHit ?? "—")} · ${String(lyricsDiag.lastErrorClass ?? "—")}`
                : "—"}
            </dd>
            <dt>Stage / search hits</dt>
            <dd>
              {lyricsDiag
                ? `${String(lyricsDiag.lastStage ?? "—")} · hits ${String(lyricsDiag.searchHitCount ?? 0)}`
                : "—"}
            </dd>
            <dt>HTTP</dt>
            <dd>
              {lyricsDiag && lyricsDiag.lastHttpStatus != null
                ? String(lyricsDiag.lastHttpStatus)
                : "—"}
            </dd>
            <dt>Rejection</dt>
            <dd>
              {lyricsDiag
                ? String(lyricsDiag.lastRejectionReason ?? "—")
                : "—"}
            </dd>
            <dt>Roman sample</dt>
            <dd>{lyricsDiag ? String(lyricsDiag.transliterationSample ?? "—") : "—"}</dd>
          </dl>
        </aside>
      )}
    </>
  );
}
