import { useEffect, useRef } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { logSyncMapping } from "../constellation/diagnostics";
import { ConstellationCamera } from "../constellation/camera";
import { getViewTransform } from "../constellation/camera";
import { buildConstellationGraph, phraseForLine } from "../constellation/layout";
import {
  EMPTY_POINTER,
  phraseSeekTimeMs,
  resolvePointerHover,
  type PointerInteraction,
} from "../constellation/interaction";
import {
  phraseMotionOffset,
  type MotionEnergy,
} from "../constellation/motion";
import { getDisplayPalette } from "../constellation/themeEngine";
import { getLatestAudioSnapshot } from "../audio/snapshotStore";
import { buildExtendedTheme } from "../constellation/mood/adaptiveTheme";
import { buildMoodProfile } from "../constellation/mood/classifier";
import {
  createRendererState,
  lineNearActive,
  renderConstellationFrame,
  renderIdleConstellationFrame,
} from "../constellation/renderer";
import type { RenderReactivity } from "../constellation/types";
import { useLyricPlaybackClock } from "../hooks/useLyricPlaybackClock";
import {
  resolveLyricPlaybackState,
} from "../lyrics/sync";
import { useAppStore } from "../stores/appStore";

function playbackMode(
  status: string | undefined,
): "playing" | "paused" | "stopped" | "idle" {
  if (!status || status === "none") {
    return "idle";
  }
  if (status === "playing") {
    return "playing";
  }
  if (status === "paused") {
    return "paused";
  }
  return "stopped";
}

function motionEnergyFromMoodAndAudio(
  audio: ReturnType<typeof getLatestAudioSnapshot>,
  moodEnergy: number,
  moodIntensity: number,
  moodBrightness: number,
  captureActive: boolean,
): MotionEnergy {
  if (captureActive && audio) {
    return {
      intensity: Math.min(1, audio.normalizedEnergy * 0.85 + 0.15),
      bass: audio.bassEnergy,
      mid: audio.midEnergy,
      treble: audio.trebleEnergy,
      onset: audio.onsetStrength,
    };
  }
  return {
    intensity: moodEnergy * 0.55 + 0.22,
    bass: moodEnergy * 0.35,
    mid: moodIntensity * 0.4,
    treble: moodBrightness * 0.3,
    onset: 0,
  };
}

export function ConstellationVisualizer() {
  const { getTimeMs } = useLyricPlaybackClock();
  const getTimeMsRef = useRef(getTimeMs);
  getTimeMsRef.current = getTimeMs;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cameraRef = useRef(new ConstellationCamera());
  const rendererStateRef = useRef(createRendererState());
  const sizeRef = useRef({ width: 720, height: 480, dpr: 1 });
  const lastTrackKeyRef = useRef<string | null>(null);
  const lastDiagRef = useRef({ line: -2, word: -2 });
  const lastCameraTargetRef = useRef({ x: 0, y: 0 });
  const layoutTimerRef = useRef<number | null>(null);
  const pointerRef = useRef<PointerInteraction>({ ...EMPTY_POINTER });
  const reducedMotionRef = useRef(false);
  const moodCacheRef = useRef<{
    ts: number;
    reactivity: RenderReactivity | null;
    motionEnergy: MotionEnergy | null;
    theme: {
      accent: string;
      textSize: number;
      palette: ReturnType<typeof getDisplayPalette>;
      backgroundTint: string;
    } | null;
  }>({ ts: 0, reactivity: null, motionEnergy: null, theme: null });

  useEffect(() => {
    reducedMotionRef.current = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const relayoutForSize = () => {
      const state = useAppStore.getState();
      if (!state.lyrics?.lines.length) {
        return;
      }
      const graph = buildConstellationGraph(
        state.lyrics.lines,
        state.settings.textSize,
        { width: sizeRef.current.width, height: sizeRef.current.height },
      );
      state.setGraph(graph);
      cameraRef.current.setBounds(graph.bounds);
    };

    const updateSize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      sizeRef.current = {
        width: Math.max(360, Math.floor(rect.width)),
        height: Math.max(280, Math.floor(rect.height)),
        dpr,
      };
      const canvas = canvasRef.current;
      if (canvas) {
        const { width, height } = sizeRef.current;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        canvas.width = Math.floor(width * dpr);
        canvas.height = Math.floor(height * dpr);
      }
      if (layoutTimerRef.current != null) {
        window.clearTimeout(layoutTimerRef.current);
      }
      layoutTimerRef.current = window.setTimeout(relayoutForSize, 180);
    };

    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(container);
    return () => {
      ro.disconnect();
      if (layoutTimerRef.current != null) {
        window.clearTimeout(layoutTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const updatePointer = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointerRef.current = {
        ...pointerRef.current,
        screenX: e.clientX - rect.left,
        screenY: e.clientY - rect.top,
        active: true,
      };
    };

    const onLeave = () => {
      pointerRef.current = { ...EMPTY_POINTER };
      canvas.style.cursor = "default";
    };

    const onClick = (e: PointerEvent) => {
      const hover = pointerRef.current.hoverLineIndex;
      if (hover < 0) {
        return;
      }
      e.stopPropagation();
      const graph = useAppStore.getState().graph;
      const phrase = graph?.phrases[hover];
      if (!phrase || phrase.empty) {
        return;
      }
      if (isTauri()) {
        invoke("media_seek_position", {
          positionMs: phraseSeekTimeMs(phrase),
        }).catch(() => {});
      }
    };

    canvas.addEventListener("pointermove", updatePointer);
    canvas.addEventListener("pointerdown", updatePointer);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("click", onClick);
    return () => {
      canvas.removeEventListener("pointermove", updatePointer);
      canvas.removeEventListener("pointerdown", updatePointer);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("click", onClick);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    let raf = 0;
    let lastTs = performance.now();

    const frame = (ts: number) => {
      const dt = Math.min(48, ts - lastTs);
      lastTs = ts;

      const state = useAppStore.getState();
      const graph = state.graph;
      const lyrics = state.lyrics;
      const np = state.nowPlaying;
      const settings = state.settings;
      const palette = getDisplayPalette(ts);
      const mode = playbackMode(np?.status);
      const playing = mode === "playing";
      const audio = getLatestAudioSnapshot();
      const captureActive =
        settings.audioReactiveEnabled &&
        settings.audioCaptureEnabled &&
        Boolean(audio?.isCapturing);

      let theme = moodCacheRef.current.theme;
      let reactivity = moodCacheRef.current.reactivity;
      let motionEnergy = moodCacheRef.current.motionEnergy;
      if (ts - moodCacheRef.current.ts > 120 || !theme || !reactivity || !motionEnergy) {
        const mood = buildMoodProfile({
          audio: captureActive ? audio : null,
          playing,
          paused: mode === "paused",
          autoMood: settings.autoMoodAdaptation,
          manualMood: settings.manualMoodOverride,
          sensitivity: settings.audioSensitivity,
          motionIntensity: settings.audioMotionIntensity,
          particleIntensity: settings.audioParticleIntensity,
        });
        const extended = buildExtendedTheme(
          palette,
          mood,
          captureActive ? (audio?.bassEnergy ?? 0) : mood.energy * 0.35,
          captureActive ? (audio?.trebleEnergy ?? 0) : mood.brightness * 0.3,
          captureActive ? (audio?.onsetStrength ?? 0) : 0,
          captureActive ? (audio?.normalizedEnergy ?? 0) : mood.energy * 0.4,
        );
        const motionIntensity = settings.audioMotionIntensity;
        theme = {
          accent: settings.autoTint ? extended.palette.primary : settings.accentColor,
          textSize: settings.textSize,
          palette: extended.palette,
          backgroundTint: extended.backgroundTint,
        };
        reactivity = {
          movementSpeed: extended.movementSpeed * motionIntensity,
          particleDensity:
            extended.particleDensity * settings.audioParticleIntensity,
          glowIntensity: extended.glowIntensity,
          connectionIntensity: extended.connectionIntensity,
          pulseStrength: extended.pulseStrength,
          bassPulse: extended.bassPulse,
          trebleSparkle: extended.trebleSparkle,
          midActivity: extended.midActivity,
          cameraResponsiveness: extended.cameraResponsiveness,
        };
        motionEnergy = motionEnergyFromMoodAndAudio(
          audio,
          mood.energy,
          mood.intensity,
          mood.brightness,
          captureActive,
        );
        moodCacheRef.current = {
          ts,
          theme,
          reactivity,
          motionEnergy,
        };
      } else {
        theme = { ...theme, palette };
      }
      const reducedMotion = reducedMotionRef.current;

      const trackKey = lyrics?.trackKey ?? np?.trackKey ?? null;
      if (trackKey && trackKey !== lastTrackKeyRef.current) {
        lastTrackKeyRef.current = trackKey;
        lastDiagRef.current = { line: -2, word: -2 };
        cameraRef.current.snapTo(0, 0);
        rendererStateRef.current = createRendererState();
      }

      if (graph) {
        cameraRef.current.setBounds(graph.bounds);
      }

      const { width, height, dpr } = sizeRef.current;

      if (!graph || !lyrics?.lines.length) {
        const idleMsg =
          mode === "idle"
            ? "Start playing music to begin"
            : state.lyricsLoading
              ? "Finding lyrics…"
              : state.lyricsError
                ? "No synced lyrics for this track"
                : "No synced lyrics yet";
        const idleSub =
          mode === "idle"
            ? "Spotify, Chrome, Edge, and other SMTC apps are supported"
            : state.lyricsLoading
              ? "LRCLIB lookup can take up to ~20s"
              : state.lyricsError ?? undefined;
        renderIdleConstellationFrame(
          ctx,
          { width, height, theme, dpr, playing: mode !== "idle" },
          rendererStateRef.current,
          dt,
          idleMsg,
          idleSub,
        );
        raf = requestAnimationFrame(frame);
        return;
      }

      const timeMs = getTimeMsRef.current(ts);

      const sync = resolveLyricPlaybackState(lyrics.lines, timeMs);
      const phrase = phraseForLine(graph, sync.activeLineIndex);
      const timeSec = timeMs * 0.001;
      const motion = rendererStateRef.current.motion;
      const motionScale = reactivity!.movementSpeed;
      const pointerActive = pointerRef.current.active;

      const phrasePositions = new Map<number, { x: number; y: number }>();
      for (let i = 0; i < graph.phrases.length; i += 1) {
        const p = graph.phrases[i];
        if (p.empty) {
          continue;
        }
        if (
          !pointerActive &&
          !lineNearActive(i, sync.activeLineIndex)
        ) {
          continue;
        }
        const off =
          motion != null
            ? phraseMotionOffset(
                motion,
                p.lineIndex,
                timeSec,
                playing,
                motionScale,
                motionEnergy!,
                reducedMotion,
              )
            : { dx: 0, dy: 0 };
        phrasePositions.set(i, { x: p.x + off.dx, y: p.y + off.dy });
      }

      const view = getViewTransform(
        width,
        height,
        graph.bounds,
        cameraRef.current.x,
        cameraRef.current.y,
      );
      const pointer = resolvePointerHover(
        graph,
        pointerRef.current,
        view,
        settings.textSize,
        phrasePositions,
      );
      pointerRef.current = pointer;
      if (canvasRef.current) {
        canvasRef.current.style.cursor =
          pointer.hoverLineIndex >= 0 ? "pointer" : "default";
      }

      if (
        sync.activeLineIndex !== lastDiagRef.current.line ||
        sync.activeWordIndex !== lastDiagRef.current.word
      ) {
        lastDiagRef.current = {
          line: sync.activeLineIndex,
          word: sync.activeWordIndex,
        };
        logSyncMapping({
          playbackTimeMs: timeMs,
          activeLineIndex: sync.activeLineIndex,
          activeLyricText: sync.activeLine?.text ?? "",
          activeNodeId: phrase?.id ?? null,
          activeWordIndex: sync.activeWordIndex,
          activeWordText:
            sync.activeWordIndex >= 0
              ? sync.activeLine?.words[sync.activeWordIndex]?.text ?? null
              : null,
          lineCount: lyrics.lines.length,
          nodeCount: graph.lineCount,
        });
      }

      if (phrase && !phrase.empty) {
        const pos =
          phrasePositions.get(phrase.lineIndex) ??
          lastCameraTargetRef.current;
        lastCameraTargetRef.current = pos;
        cameraRef.current.setTarget(pos.x, pos.y);
      } else {
        cameraRef.current.setTarget(
          lastCameraTargetRef.current.x,
          lastCameraTargetRef.current.y,
        );
      }
      cameraRef.current.update(
        dt,
        reactivity.cameraResponsiveness,
        playing,
        reducedMotion,
      );

      renderConstellationFrame(
        ctx,
        {
          width,
          height,
          graph,
          timeMs,
          playing,
          theme,
          cameraX: cameraRef.current.x,
          cameraY: cameraRef.current.y,
          dpr,
          reactivity: reactivity!,
          pointer,
          reducedMotion,
          motionEnergy: motionEnergy!,
        },
        rendererStateRef.current,
        dt,
        sync.activeLineIndex,
        sync.activeLine,
        playing ? sync.activeWordIndex : -1,
      );

      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div ref={containerRef} className="constellation-stage">
      <canvas
        ref={canvasRef}
        className="constellation-canvas"
        aria-label="Constellation lyrics visualizer"
      />
    </div>
  );
}
