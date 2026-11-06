# Lyrics provider benchmark

**Date:** 2026-10-31 (UTC)  
**Method:** Live HTTP probes from Windows via `scripts/benchmark-lyrics-providers.ps1` (Roman metadata, album + duration where noted). Automated tests use mocks only.

## Provider summary

| Provider | Public API | API key | Hindi/Bollywood | Sync format | Timing | Rate limits | Desktop app suitability |
|----------|------------|---------|-----------------|-------------|--------|-------------|-------------------------|
| **LRCLIB** | `https://lrclib.net/api/get`, `/api/search` | No | Moderate (many gaps) | LRC | Line (sometimes plain) | Unknown; frequent 502/503 | OK (open API; outage-prone) |
| **lrcmux** | `https://api.lrcmux.dev/get` (OpenAPI at `lrcmux.dev`) | No | **Strong** in this run | JSON → LRC-like lines | Word or line (`level`) | Unknown | OK; use official `api.` host only |
| **Better Lyrics** | `https://api.betterlyrics.org/getLyrics` | No | **401 on probe** (uncached) | JSON `{ ttml }` | Word (TTML spans) when cached | 401 on cache miss | OK for hits; Hindi often uncached |
| **Karalyr** | Documented LRCLIB-compatible `/api/get` | No | Not verified | LRC | Line | Unknown | **Unreliable** (308/404 in probes) |
| **Lyrica** | Self-hosted | N/A | Depends on sources | Multiple | Varies | N/A | Self-host only (not wired remotely) |

## Benchmark matrix (subset — 5 Hindi + 5 English)

Legend: **OK** = HTTP 2xx with plausible payload; **502/401/404/308** = failure at probe time.

| Song | LRCLIB | lrcmux | Better Lyrics | Karalyr |
|------|--------|--------|---------------|---------|
| Kesariya — Arijit Singh | 502 (~3s) | **OK** 200, line, ~1.9s | 401 | 308 |
| Channa Mereya — Arijit Singh | 502 | **OK** 200, line, ~2.4s | 401 | 308 |
| Tum Hi Ho — Arijit Singh | 502 | **OK** 200, **word**, ~1.8s | 401 | 308 |
| Apna Bana Le — Arijit Singh | 502 | **OK** 200, line, ~2.2s | 401 | 308 |
| Raataan Lambiyan — Jubin Nautiyal | 502 | **OK** 200, line, ~1.9s | 401 | 308 |
| Die For You — The Weeknd | 502 | **OK** 200, word, ~1.1s | **OK** 200 (~1.2s) | 308 |
| Love Story — Taylor Swift | 502 | **OK** 200, word, ~0.7s | **OK** 200 (~0.6s) | 308 |
| Señorita — Shawn Mendes | 502 | 404 | 401 | 308 |
| Harleys in Hawaii — Katy Perry | 502 | **OK** 200, word, ~1.8s | 401 | 308 |
| We Don't Talk Anymore — Charlie Puth | 502 | **OK** 200, word, ~2.6s | **OK** 200 (~1.4s) | 308 |

Raw CSV: `benchmark-probe-output.csv` (repo root, generated locally).

### Observations

1. **LRCLIB** returned **502** for every probe during this window — matches production pain; Constellation still uses LRCLIB first, then fallbacks.
2. **lrcmux** covered **9/10** tracks (all Hindi + most English); **word-level** on several English and Tum Hi Ho; **404** on Señorita (encoding/title mismatch in probe).
3. **Better Lyrics** succeeded on **3/10** (English cache hits); **401** on Hindi and most English without a warm cache key (album + duration required per docs).
4. **Karalyr** did not return lyrics in probes (**308** redirect on `karalyr.com`, **404** on `www.karalyr.com` for Love Story). Left in chain as optional env override but **low priority**.
5. **Devanagari metadata** was not re-run in this CSV; LRCLIB search variants + lrcmux Roman GET are covered in Rust unit tests and Hindi variant pipeline.

## Constellation integration (this change)

**Fallback order:** LRCLIB → lrcmux → Better Lyrics → Karalyr  
**Circuit breaker:** 2× 5xx/connectivity → skip provider 120s  
**Unified output:** existing `LyricsResult` / constellation graph unchanged  
**Hindi:** search variants unchanged; alternate providers preserve Unicode in timed payloads  

## Lyrica

Evaluated as **self-hosted** only (Spotify-oriented scraper stack). Not added as a default remote dependency.
