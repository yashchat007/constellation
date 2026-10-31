# Constellation (Windows)

Free, open-source mini player with **Constellation** synced lyrics — reads **Windows Now Playing (SMTC)** from Spotify, browsers, and other apps.

## Stack

- Tauri 2 + Rust (SMTC, LRCLIB lyrics cache)
- React + TypeScript + Canvas 2D

## Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [Rust](https://rustup.rs/) (MSVC toolchain)
- WebView2 (included on Windows 11)

## Develop

Close and reopen your terminal after installing Rust (or use the npm script below, which refreshes PATH on Windows).

```powershell
cd c:\Users\Yash\Desktop\Constellation
npm install
npm run tauri dev
```

## Build

```powershell
npm run tauri build
```

Installer output: `src-tauri\target\release\bundle\`

## Features (MVP)

- System now playing metadata + album art (SMTC)
- Play / pause / skip (best effort per app)
- LRCLIB synced lyrics + local `.lrc` import
- Constellation word graph with active-word highlight
- Settings: lyric offset, text size, accent color, always on top

## Lyrics

Primary source: [LRCLIB](https://lrclib.net/) (no API key). If a track is missing, use **Settings → Import .lrc**.

## License

Personal project — add a license if you publish.
