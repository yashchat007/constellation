# Constellation

**Actively developed** — a free, open-source **Windows** desktop mini player with a **constellation-style** synced lyrics visualizer. It reads **Windows System Media Transport Controls (SMTC)** “now playing” from Spotify, browsers, and other apps, and fetches timed lyrics from public providers (no API keys required for normal use).

## Features

- **Now playing** from SMTC: title, artist, album, duration, position, album art (with sensible rejection of junk thumbnails)
- **Transport**: play/pause, next, previous, seek (best effort per media app)
- **Lyrics**: multi-provider chain (LRCLIB → [lrcmux](https://api.lrcmux.dev) → Better Lyrics → optional Karalyr base), Hindi-aware title/artist normalization, local `.lrc` import
- **Visualizer**: Canvas 2D “constellation” graph with word-level sync when available; **audio-reactive** mood via WASAPI loopback capture
- **Views**: Lyrics view and **Classic** view
- **Settings** (persisted): lyric offset, text size, accent color, always-on-top, and related options  
  **Theme**: black background with **cyan/blue** accents (by design)

## Technology stack

| Layer | Tech |
|--------|------|
| Desktop shell | **Tauri 2** (Rust, WebView2) |
| Frontend | **React 19**, **TypeScript**, **Vite 8**, **Zustand** |
| Windows media | SMTC (`windows` crate — `Media_Control`) |
| Audio features | WASAPI loopback (`wasapi`), FFT / feature extraction |
| Lyrics | `reqwest` + LRCLIB-compatible APIs, on-disk cache under app data |

## Architecture (high level)

```
SMTC (now playing) ──► Rust backend ──► Tauri commands ──► React UI
                              │
WASAPI loopback (mix) ──► audio features ──► mood / motion for constellation
                              │
Lyrics providers ──► match + parse (LRC / TTML / JSON) ──► unified line/word model ──► Canvas
```

Production builds embed the **static** `dist/` output from Vite; **no browser** and **no dev server** are required at runtime.

## Prerequisites (development)

- **Node.js** 20+
- **Rust** stable ( MSVC toolchain on Windows )
- **WebView2** (bundled on Windows 11; [ Evergreen Runtime](https://developer.microsoft.com/microsoft-edge/webview2/) on older Windows if needed)

## Development setup

```powershell
cd path\to\Constellation
npm install
npm run tauri dev
```

`tauri dev` runs Vite on `http://localhost:1420` and connects the WebView for hot reload.

## Tests and checks

```powershell
npm test
npm run build
cd src-tauri
cargo test --lib
cargo check
cargo build --release
```

## Production build (Windows installers)

From the repo root:

```powershell
npm install
npm run tauri build
```

Artifacts (typical locations):

- **NSIS**: `src-tauri\target\release\bundle\nsis\Constellation_0.1.0_x64-setup.exe`
- **MSI** (WiX): `src-tauri\target\release\bundle\msi\Constellation_0.1.0_x64_en-US.msi`

Exact filenames may vary slightly with version bumps. Installers are generated under `src-tauri\target\release\bundle\` and are **gitignored** — build locally for release.

### Runtime expectations

- Network access for lyrics providers (HTTPS).
- No paid API keys required for default providers.
- Optional env overrides (advanced): `CONSTELLATION_LRCLIB_BASE`, `CONSTELLATION_LRCMUX_BASE`, `CONSTELLATION_KARALYR_BASE`, `CONSTELLATION_LOG` (see source).

## Lyrics providers

| Order | Provider | Notes |
|------|-----------|--------|
| 1 | [LRCLIB](https://lrclib.net) | Primary; can see 5xx outages |
| 2 | lrcmux | `https://api.lrcmux.dev` by default |
| 3 | [Better Lyrics](https://docs.betterlyrics.org/) | TTML when cached |
| 4 | Karalyr | Optional base URL |

See **`LYRICS_PROVIDER_BENCHMARK.md`** for a live-probe style matrix (informational; re-run probes on your network as needed).

## Known limitations

- **SMTC** coverage depends on each media app exposing session metadata.
- **Lyrics** catalog gaps and provider outages can still cause misses; use **Retry** or **Import .lrc**.
- Hindi tracks with noisy YouTube-style titles rely on title/artist heuristics; edge cases may need a manual `.lrc`.
- **Audio reactive** capture uses system mix loopback; behavior varies by driver and exclusive-mode apps.

## Repository

**https://github.com/yashchat007/constellation**

## License

Add a `LICENSE` file when you want a formal open-source terms; the project is intended as an **open portfolio** piece.
