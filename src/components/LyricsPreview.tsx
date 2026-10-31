import { useState, useEffect, useRef } from "react";
import { useAppStore } from "../stores/appStore";
import { useLyricPlaybackClock } from "../hooks/useLyricPlaybackClock";
import { resolveLyricPlaybackState } from "../lyrics/sync";

export function LyricsPreview() {
  const lyrics = useAppStore((s) => s.lyrics);
  const nowPlaying = useAppStore((s) => s.nowPlaying);
  const accent = useAppStore((s) => s.settings.accentColor);
  const { getTimeMs } = useLyricPlaybackClock();
  const getTimeMsRef = useRef(getTimeMs);
  getTimeMsRef.current = getTimeMs;

  const [activeIdx, setActiveIdx] = useState(-1);
  const activeRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!lyrics?.lines.length) {
      setActiveIdx(-1);
      return;
    }

    let raf = 0;
    let lastIdx = -2;

    const tick = () => {
      const t = getTimeMsRef.current();
      const sync = resolveLyricPlaybackState(lyrics.lines, t);
      const idx = sync.activeLineIndex;
      if (idx !== lastIdx) {
        lastIdx = idx;
        setActiveIdx(idx);
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [lyrics, nowPlaying?.positionMs, nowPlaying?.status]);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeIdx]);

  if (!lyrics?.lines.length) {
    return (
      <div className="lyrics-preview lyrics-preview-empty">
        <p>No synced lyrics yet.</p>
      </div>
    );
  }

  return (
    <div className="lyrics-preview" style={{ ["--lyrics-accent" as string]: accent }}>
      {lyrics.lines.map((line, i) => {
        const state =
          i === activeIdx ? "active" : i < activeIdx ? "past" : "upcoming";
        return (
          <div
            key={`${line.startMs}-${i}`}
            ref={i === activeIdx ? activeRef : undefined}
            className={`lyrics-line lyrics-line-${state}`}
          >
            {line.text}
          </div>
        );
      })}
    </div>
  );
}
