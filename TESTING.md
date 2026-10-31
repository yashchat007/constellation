# Constellation — manual QA (Windows)

Run the app with `npm run tauri dev` or the release binary. Use this checklist before calling v1 done.

| # | Scenario | Steps | Expected |
|---|----------|-------|----------|
| 1 | Spotify metadata | Play a track in Spotify desktop | Title, artist, art update within ~1s |
| 2 | Transport | Use in-app prev / play-pause / next | Spotify (or active app) responds |
| 3 | Browser | Play YouTube in Chrome/Edge | Now playing updates; controls if exposed |
| 4 | Lyrics hit | Popular track with LRCLIB entry | Constellation nodes appear; words highlight |
| 5 | Lyrics miss | Obscure track | Status message; Import .lrc works |
| 6 | Skip track | Next song while playing | Lyrics reload for new track |
| 7 | Pause | Pause in source app | Highlight stops advancing |
| 8 | Seek | Scrub timeline in source app | Active word jumps (± offset setting) |
| 9 | Offset | Adjust lyric offset in Settings | Highlight leads/lags correctly |
| 10 | Always on top | Toggle on | Window stays above others |
| 11 | Tray | Left-click tray icon | Window shows and focuses |
| 12 | Session switch | Play two apps; switch active audio | Metadata follows new session |

## Notes

- Some apps do not expose **position** via SMTC; highlighting may rely on polled position only while playing.
- Transport buttons depend on the source app implementing skip/play.
