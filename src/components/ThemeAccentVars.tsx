import { useEffect } from "react";
import { getDisplayPalette } from "../constellation/themeEngine";

function applyPaletteCssVars(palette: ReturnType<typeof getDisplayPalette>) {
  const root = document.documentElement;
  root.style.setProperty("--c-accent", palette.primary);
  root.style.setProperty("--c-accent-dim", palette.secondary);
  root.style.setProperty("--c-accent-hi", palette.highlight);
  root.style.setProperty("--c-text", palette.text);
  root.style.setProperty("--c-bg-tint", palette.backgroundTint);
}

/** Syncs UI chrome to the live interpolated canvas palette (no React store per frame). */
export function ThemeAccentVars() {
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      applyPaletteCssVars(getDisplayPalette());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return null;
}
