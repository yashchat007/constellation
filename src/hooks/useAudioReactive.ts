import { useEffect } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AudioCaptureStatus } from "../types";
import {
  parseAudioSnapshot,
  setAudioCaptureStatus,
  setLatestAudioSnapshot,
} from "../audio/snapshotStore";
import { useAppStore } from "../stores/appStore";

export function useAudioReactiveEngine() {
  const audioReactiveEnabled = useAppStore((s) => s.settings.audioReactiveEnabled);
  const audioCaptureEnabled = useAppStore((s) => s.settings.audioCaptureEnabled);
  const audioSensitivity = useAppStore((s) => s.settings.audioSensitivity);
  const audioSmoothing = useAppStore((s) => s.settings.audioSmoothing);
  const setCaptureActive = useAppStore((s) => s.setAudioCaptureActive);

  useEffect(() => {
    if (!isTauri()) {
      return;
    }

    let cancelled = false;
    let unlisten: (() => void) | undefined;
    let pollTimer: number | undefined;

    const syncStatus = async () => {
      const status = await invoke<AudioCaptureStatus>("get_audio_capture_status");
      if (!cancelled) {
        setAudioCaptureStatus(status);
        setCaptureActive(status.isCapturing);
      }
    };

    const pollFeatures = async () => {
      if (cancelled) return;
      try {
        const snap = await invoke<unknown>("get_audio_features");
        const parsed = parseAudioSnapshot(snap);
        if (parsed) {
          setLatestAudioSnapshot(parsed);
        }
      } catch {
        /* ignore */
      }
    };

    (async () => {
      unlisten = await listen("audio-features", (event) => {
        const snap = parseAudioSnapshot(event.payload);
        if (snap) {
          setLatestAudioSnapshot(snap);
        }
      });
      await syncStatus();
      pollTimer = window.setInterval(() => {
        if (useAppStore.getState().settings.audioCaptureEnabled) {
          pollFeatures();
        }
      }, 750);
    })();

    return () => {
      cancelled = true;
      unlisten?.();
      if (pollTimer != null) {
        window.clearInterval(pollTimer);
      }
    };
  }, [setCaptureActive]);

  useEffect(() => {
    if (!isTauri()) {
      return;
    }
    invoke("set_audio_analysis_tuning", {
      sensitivity: audioSensitivity,
      smoothing: audioSmoothing,
    }).catch(() => {});
  }, [audioSensitivity, audioSmoothing]);

  useEffect(() => {
    if (!isTauri()) {
      return;
    }

    if (!audioReactiveEnabled || !audioCaptureEnabled) {
      invoke("stop_audio_capture").catch(() => {});
      useAppStore.getState().setAudioCaptureActive(false);
      return;
    }

    invoke("start_audio_capture")
      .then(() => useAppStore.getState().setAudioCaptureActive(true))
      .catch(() => useAppStore.getState().setAudioCaptureActive(false));

    return () => {
      invoke("stop_audio_capture").catch(() => {});
    };
  }, [audioReactiveEnabled, audioCaptureEnabled]);
}
