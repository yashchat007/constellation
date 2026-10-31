use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum SmtcError {
    #[error("Windows media APIs are only available on Windows")]
    Unsupported,
    #[error("{0}")]
    Message(String),
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct NowPlaying {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub status: PlaybackStatus,
    pub position_ms: Option<u64>,
    pub duration_ms: Option<u64>,
    pub artwork_data_url: Option<String>,
    pub track_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PlaybackStatus {
    #[default]
    None,
    Playing,
    Paused,
    Stopped,
}

#[cfg(not(windows))]
pub fn start_smtc_service() {}

#[cfg(not(windows))]
pub fn read_now_playing() -> Result<NowPlaying, SmtcError> {
    Err(SmtcError::Unsupported)
}

#[cfg(not(windows))]
pub fn media_play_pause() -> Result<(), SmtcError> {
    Err(SmtcError::Unsupported)
}

#[cfg(not(windows))]
pub fn media_next() -> Result<(), SmtcError> {
    Err(SmtcError::Unsupported)
}

#[cfg(not(windows))]
pub fn media_previous() -> Result<(), SmtcError> {
    Err(SmtcError::Unsupported)
}

#[cfg(not(windows))]
pub fn media_seek_ms(_position_ms: u64) -> Result<(), SmtcError> {
    Err(SmtcError::Unsupported)
}

#[cfg(windows)]
mod win {
    use super::{NowPlaying, PlaybackStatus, SmtcError};
    use crate::artwork_validate::is_plausible_album_artwork;
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::mpsc::{self, Receiver, SyncSender};
    use std::sync::{Arc, Mutex, OnceLock};
    use std::thread;
    use std::time::Duration;
    use windows::{
        core::Interface,
        Foundation::{TimeSpan, TypedEventHandler},
        Media::Control::{
            GlobalSystemMediaTransportControlsSession,
            GlobalSystemMediaTransportControlsSessionManager,
            GlobalSystemMediaTransportControlsSessionMediaProperties,
            GlobalSystemMediaTransportControlsSessionPlaybackStatus,
        },
        Storage::Streams::{DataReader, IRandomAccessStreamWithContentType},
        Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED},
    };
    use windows::core::RuntimeType;

    enum WorkerMsg {
        PlayPause,
        Next,
        Previous,
        Seek(u64),
    }

    static SNAPSHOT: OnceLock<Arc<Mutex<NowPlaying>>> = OnceLock::new();
    static WORKER_TX: OnceLock<SyncSender<WorkerMsg>> = OnceLock::new();

    fn win_err<E: std::fmt::Display>(e: E) -> SmtcError {
        SmtcError::Message(e.to_string())
    }

    fn block_op<T: RuntimeType>(
        op: windows_future::IAsyncOperation<T>,
    ) -> Result<T, SmtcError> {
        op.get().map_err(win_err)
    }

    fn init_com_on_thread() {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        }
    }

    fn smtc_log(msg: impl AsRef<str>) {
        if cfg!(debug_assertions) || std::env::var_os("CONSTELLATION_LOG").is_some() {
            eprintln!("[constellation:smtc] {}", msg.as_ref());
        }
    }

    fn map_status(
        status: GlobalSystemMediaTransportControlsSessionPlaybackStatus,
    ) -> PlaybackStatus {
        match status {
            GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing => {
                PlaybackStatus::Playing
            }
            GlobalSystemMediaTransportControlsSessionPlaybackStatus::Paused => {
                PlaybackStatus::Paused
            }
            GlobalSystemMediaTransportControlsSessionPlaybackStatus::Stopped => {
                PlaybackStatus::Stopped
            }
            _ => PlaybackStatus::None,
        }
    }

    fn status_label(
        status: GlobalSystemMediaTransportControlsSessionPlaybackStatus,
    ) -> &'static str {
        match status {
            GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing => "playing",
            GlobalSystemMediaTransportControlsSessionPlaybackStatus::Paused => "paused",
            GlobalSystemMediaTransportControlsSessionPlaybackStatus::Stopped => "stopped",
            GlobalSystemMediaTransportControlsSessionPlaybackStatus::Closed => "closed",
            GlobalSystemMediaTransportControlsSessionPlaybackStatus::Changing => "changing",
            _ => "unknown",
        }
    }

    fn timespan_to_ms(span: TimeSpan) -> u64 {
        (span.Duration / 10_000).max(0) as u64
    }

    fn request_manager() -> Result<GlobalSystemMediaTransportControlsSessionManager, SmtcError> {
        let op = GlobalSystemMediaTransportControlsSessionManager::RequestAsync().map_err(win_err)?;
        block_op(op)
    }

    fn session_aumid(session: &GlobalSystemMediaTransportControlsSession) -> String {
        session
            .SourceAppUserModelId()
            .ok()
            .map(|h| h.to_string())
            .unwrap_or_else(|| "<unknown>".to_string())
    }

    fn is_likely_browser(aumid: &str) -> bool {
        let a = aumid.to_lowercase();
        [
            "chrome", "msedge", "edge", "firefox", "opera", "brave", "vivaldi", "chromium",
        ]
        .iter()
        .any(|needle| a.contains(needle))
    }

    fn non_empty_hstring(result: windows::core::Result<windows::core::HSTRING>) -> Option<String> {
        result
            .ok()
            .map(|h| h.to_string())
            .filter(|s| !s.trim().is_empty())
    }

    fn clean_video_title(title: &str) -> String {
        let mut out = String::new();
        let mut depth = 0u32;
        for ch in title.chars() {
            match ch {
                '(' | '[' => depth += 1,
                ')' | ']' if depth > 0 => depth -= 1,
                _ if depth == 0 => out.push(ch),
                _ => {}
            }
        }
        out.split_whitespace().collect::<Vec<_>>().join(" ")
    }

    fn split_title_artist(raw_title: &str) -> (Option<String>, Option<String>) {
        let cleaned = clean_video_title(raw_title);
        if cleaned.is_empty() {
            return (None, None);
        }
        if let Some((artist, title)) = cleaned.split_once(" - ") {
            let artist = artist.trim();
            let title = title.trim();
            if !artist.is_empty() && !title.is_empty() {
                return (Some(title.to_string()), Some(artist.to_string()));
            }
        }
        (Some(cleaned), None)
    }

    #[derive(Clone)]
    struct SessionCandidate {
        label: String,
        session: GlobalSystemMediaTransportControlsSession,
        aumid: String,
        playback_status: GlobalSystemMediaTransportControlsSessionPlaybackStatus,
        score: i32,
    }

    fn score_session_light(session: &GlobalSystemMediaTransportControlsSession, from: &str) -> SessionCandidate {
        let aumid = session_aumid(session);
        let mut score = 0i32;

        let playback_status = session
            .GetPlaybackInfo()
            .ok()
            .and_then(|info| info.PlaybackStatus().ok())
            .unwrap_or_default();

        match playback_status {
            GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing => score += 100,
            GlobalSystemMediaTransportControlsSessionPlaybackStatus::Paused => score += 45,
            GlobalSystemMediaTransportControlsSessionPlaybackStatus::Stopped => score += 10,
            _ => score += 1,
        }

        if is_likely_browser(&aumid) {
            score += 30;
            if playback_status
                == GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing
            {
                score += 20;
            }
        }

        if from == "GetCurrentSession" {
            score += 5;
        }

        SessionCandidate {
            label: from.to_string(),
            session: session.clone(),
            aumid,
            playback_status,
            score,
        }
    }

    fn enumerate_session_candidates(
        manager: &GlobalSystemMediaTransportControlsSessionManager,
    ) -> Vec<SessionCandidate> {
        let mut candidates: Vec<SessionCandidate> = Vec::new();

        if let Ok(current) = manager.GetCurrentSession() {
            candidates.push(score_session_light(&current, "GetCurrentSession"));
        }

        if let Ok(list) = manager.GetSessions() {
            if let Ok(count) = list.Size() {
                for i in 0..count {
                    if let Ok(session) = list.GetAt(i) {
                        candidates.push(score_session_light(
                            &session,
                            &format!("GetSessions[{i}]"),
                        ));
                    }
                }
            }
        }

        candidates.sort_by(|a, b| b.score.cmp(&a.score));
        let mut deduped: Vec<SessionCandidate> = Vec::new();
        for c in candidates {
            if deduped.iter().any(|d| d.aumid == c.aumid) {
                continue;
            }
            deduped.push(c);
        }
        deduped.sort_by(|a, b| b.score.cmp(&a.score));
        deduped
    }

    fn log_session_diagnostics(
        candidates: &[SessionCandidate],
        selected: Option<&SessionCandidate>,
        last_signature: &mut String,
    ) {
        let mut lines = Vec::new();
        lines.push(format!("detected {} session(s)", candidates.len()));

        if candidates.is_empty() {
            lines.push(
                "Windows exposes NO media sessions — browser/YouTube is not visible to SMTC on this machine. \
                 Confirm the track appears in the Windows volume flyout (Quick Settings → media controls)."
                    .to_string(),
            );
        } else {
            for c in candidates {
                lines.push(format!(
                    "{} aumid={} playback={} score={}",
                    c.label,
                    c.aumid,
                    status_label(c.playback_status),
                    c.score
                ));
            }
        }

        if let Some(c) = selected {
            lines.push(format!(
                "SELECTED {} aumid={} playback={} score={}",
                c.label,
                c.aumid,
                status_label(c.playback_status),
                c.score
            ));
        } else if !candidates.is_empty() {
            lines.push("SELECTED none (all sessions scored 0 or unusable)".to_string());
        }

        let signature = lines.join("\n");
        if signature != *last_signature {
            for line in &lines {
                smtc_log(line);
            }
            *last_signature = signature;
        }
    }

    fn select_best_session(
        manager: &GlobalSystemMediaTransportControlsSessionManager,
        last_signature: &mut String,
        last_aumid: &mut Option<String>,
    ) -> Option<SessionCandidate> {
        let mut candidates = enumerate_session_candidates(manager);
        if let Some(ref sticky) = last_aumid {
            for c in &mut candidates {
                if c.aumid == *sticky {
                    c.score += 20;
                    if c.playback_status
                        == GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing
                    {
                        c.score += 15;
                    }
                }
            }
            candidates.sort_by(|a, b| b.score.cmp(&a.score));
        }
        let best = candidates
            .iter()
            .filter(|c| c.score > 0)
            .max_by_key(|c| c.score)
            .cloned();
        log_session_diagnostics(&candidates, best.as_ref(), last_signature);
        if let Some(ref b) = best {
            *last_aumid = Some(b.aumid.clone());
        } else {
            *last_aumid = None;
        }
        best
    }

    fn read_thumbnail(
        media: &GlobalSystemMediaTransportControlsSessionMediaProperties,
    ) -> Result<Option<String>, SmtcError> {
        let thumbnail = match media.Thumbnail() {
            Ok(t) => t,
            Err(_) => return Ok(None),
        };

        let stream = block_op(thumbnail.OpenReadAsync().map_err(win_err)?)?;
        let stream: IRandomAccessStreamWithContentType = stream.cast().map_err(win_err)?;

        let size = stream.Size().map_err(win_err)? as usize;
        if size == 0 || size > 2_000_000 {
            return Ok(None);
        }

        let reader = DataReader::CreateDataReader(&stream).map_err(win_err)?;
        block_op(reader.LoadAsync(size as u32).map_err(win_err)?)?;

        let mut raw = vec![0u8; size];
        reader.ReadBytes(&mut raw).map_err(win_err)?;

        if !is_plausible_album_artwork(&raw) {
            smtc_log(format!(
                "thumbnail rejected (size={size} bytes — likely app/icon, not album art)"
            ));
            return Ok(None);
        }

        let mime = if raw.starts_with(&[0xFF, 0xD8]) {
            "image/jpeg"
        } else if raw.starts_with(b"\x89PNG") {
            "image/png"
        } else {
            "image/jpeg"
        };
        let b64 = STANDARD.encode(raw);
        Ok(Some(format!("data:{mime};base64,{b64}")))
    }

    fn build_track_key(
        title: &Option<String>,
        artist: &Option<String>,
        duration_ms: &Option<u64>,
    ) -> Option<String> {
        let title = title.as_ref().filter(|t| !t.trim().is_empty())?;
        let artist = artist
            .as_ref()
            .map(|a| a.trim().to_lowercase())
            .filter(|a| !a.is_empty());
        let dur = duration_ms
            .filter(|d| *d > 0)
            .map(|d| d.to_string())
            .unwrap_or_default();
        Some(match artist {
            Some(a) => format!("{a}::{}::{}", title.to_lowercase(), dur),
            None => format!("::{}::{}", title.to_lowercase(), dur),
        })
    }

    fn session_to_now_playing(
        session: &GlobalSystemMediaTransportControlsSession,
        last_track_key: &mut Option<String>,
        cached_art: &mut Option<String>,
    ) -> NowPlaying {
        let playback = match session.GetPlaybackInfo() {
            Ok(p) => p,
            Err(e) => {
                smtc_log(format!("GetPlaybackInfo failed: {e}"));
                return NowPlaying::default();
            }
        };
        let status = map_status(playback.PlaybackStatus().unwrap_or_default());

        let timeline = session.GetTimelineProperties().ok();
        let position_ms = timeline
            .as_ref()
            .map(|t| timespan_to_ms(t.Position().unwrap_or_default()));
        let duration_ms = timeline
            .as_ref()
            .map(|t| timespan_to_ms(t.EndTime().unwrap_or_default()));

        let (mut title, mut artist, album) = match session.TryGetMediaPropertiesAsync() {
            Ok(op) => match block_op(op) {
                Ok(media) => {
                    let title = non_empty_hstring(media.Title())
                        .or_else(|| non_empty_hstring(media.Subtitle()));
                    let artist = non_empty_hstring(media.Artist())
                        .or_else(|| non_empty_hstring(media.AlbumArtist()))
                        .or_else(|| non_empty_hstring(media.AlbumTitle()));
                    let album = non_empty_hstring(media.AlbumTitle());

                    let track_key = build_track_key(&title, &artist, &duration_ms);
                    if track_key != *last_track_key {
                        *last_track_key = track_key.clone();
                        *cached_art = None;
                        if let Ok(Some(data)) = read_thumbnail(&media) {
                            *cached_art = Some(data);
                        }
                    }
                    let artwork_data_url = cached_art.clone();

                    if title.is_some() {
                        return NowPlaying {
                            title,
                            artist,
                            album,
                            status,
                            position_ms,
                            duration_ms,
                            artwork_data_url,
                            track_key,
                        };
                    }

                    (title, artist, album)
                }
                Err(e) => {
                    smtc_log(format!(
                        "TryGetMediaPropertiesAsync failed (keeping playback status): {e}"
                    ));
                    (None, None, None)
                }
            },
            Err(e) => {
                smtc_log(format!(
                    "TryGetMediaPropertiesAsync unavailable (keeping playback status): {e}"
                ));
                (None, None, None)
            }
        };

        if title.is_none() {
            smtc_log(
                "No title from SMTC media properties for selected session — Windows did not publish title metadata.",
            );
        } else if artist.is_none() {
            if let Some(ref raw) = title {
                let (parsed_title, parsed_artist) = split_title_artist(raw);
                title = parsed_title.or(title);
                artist = parsed_artist;
            }
        }

        let track_key = build_track_key(&title, &artist, &duration_ms);
        if track_key != *last_track_key {
            *last_track_key = track_key.clone();
            *cached_art = None;
        }

        NowPlaying {
            title,
            artist,
            album,
            status,
            position_ms,
            duration_ms,
            artwork_data_url: cached_art.clone(),
            track_key,
        }
    }

    fn poll_once(
        manager: &GlobalSystemMediaTransportControlsSessionManager,
        last_track_key: &mut Option<String>,
        cached_art: &mut Option<String>,
        last_signature: &mut String,
        last_aumid: &mut Option<String>,
        subscribed_aumid: &mut Option<String>,
        wake: &Arc<AtomicBool>,
    ) -> (NowPlaying, Option<GlobalSystemMediaTransportControlsSession>) {
        let Some(candidate) =
            select_best_session(manager, last_signature, last_aumid)
        else {
            *subscribed_aumid = None;
            return (NowPlaying::default(), None);
        };
        if subscribed_aumid.as_ref() != Some(&candidate.aumid) {
            register_session_events(&candidate.session, wake.clone());
            *subscribed_aumid = Some(candidate.aumid.clone());
            smtc_log(format!(
                "subscribed session events aumid={}",
                candidate.aumid
            ));
        }
        let np = session_to_now_playing(&candidate.session, last_track_key, cached_art);
        (np, Some(candidate.session))
    }

    fn handle_control(
        session: &GlobalSystemMediaTransportControlsSession,
        msg: WorkerMsg,
    ) -> Result<(), SmtcError> {
        match msg {
            WorkerMsg::PlayPause => {
                let info = session.GetPlaybackInfo().map_err(win_err)?;
                let status = info.PlaybackStatus().unwrap_or_default();
                if status == GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing {
                    block_op(session.TryPauseAsync().map_err(win_err)?)?;
                } else {
                    block_op(session.TryPlayAsync().map_err(win_err)?)?;
                }
                Ok(())
            }
            WorkerMsg::Next => {
                block_op(session.TrySkipNextAsync().map_err(win_err)?)?;
                Ok(())
            }
            WorkerMsg::Previous => {
                block_op(session.TrySkipPreviousAsync().map_err(win_err)?)?;
                Ok(())
            }
            WorkerMsg::Seek(ms) => {
                let ticks = (ms as i64).saturating_mul(10_000);
                block_op(
                    session
                        .TryChangePlaybackPositionAsync(ticks)
                        .map_err(win_err)?,
                )?;
                Ok(())
            }
        }
    }

    fn register_session_events(
        session: &GlobalSystemMediaTransportControlsSession,
        wake: Arc<AtomicBool>,
    ) {
        let w = wake.clone();
        let _ = session.MediaPropertiesChanged(&TypedEventHandler::new(
            move |_s, _args| {
                w.store(true, Ordering::Release);
                Ok(())
            },
        ));
        let w2 = wake.clone();
        let _ = session.PlaybackInfoChanged(&TypedEventHandler::new(
            move |_s, _args| {
                w2.store(true, Ordering::Release);
                Ok(())
            },
        ));
        let w3 = wake.clone();
        let _ = session.TimelinePropertiesChanged(&TypedEventHandler::new(
            move |_s, _args| {
                w3.store(true, Ordering::Release);
                Ok(())
            },
        ));
    }

    fn register_manager_events(
        manager: &GlobalSystemMediaTransportControlsSessionManager,
        wake: Arc<AtomicBool>,
    ) {
        let wake_sessions = wake.clone();
        let _ = manager.SessionsChanged(&TypedEventHandler::new(
            move |_manager, _args| {
                wake_sessions.store(true, Ordering::Release);
                Ok(())
            },
        ));

        let wake_current = wake.clone();
        let _ = manager.CurrentSessionChanged(&TypedEventHandler::new(
            move |_manager, _args| {
                wake_current.store(true, Ordering::Release);
                Ok(())
            },
        ));
    }

    fn worker_main(rx: Receiver<WorkerMsg>, snapshot: Arc<Mutex<NowPlaying>>) {
        init_com_on_thread();
        smtc_log("worker started (COM MTA)");

        let manager = loop {
            match request_manager() {
                Ok(m) => {
                    smtc_log("GlobalSystemMediaTransportControlsSessionManager ready");
                    break m;
                }
                Err(e) => {
                    smtc_log(format!("RequestAsync failed: {e}; retrying in 2s"));
                    thread::sleep(Duration::from_secs(2));
                }
            }
        };

        let wake = Arc::new(AtomicBool::new(true));
        register_manager_events(&manager, wake.clone());

        let mut last_track_key: Option<String> = None;
        let mut cached_art: Option<String> = None;
        let mut active_session: Option<GlobalSystemMediaTransportControlsSession> = None;
        let mut last_diag_signature = String::new();
        let mut last_aumid: Option<String> = None;
        let mut subscribed_aumid: Option<String> = None;

        loop {
            while let Ok(msg) = rx.try_recv() {
                if let Some(ref session) = active_session {
                    if let Err(e) = handle_control(session, msg) {
                        smtc_log(format!("media control failed: {e}"));
                    }
                } else {
                    smtc_log("media control ignored — no active session selected");
                }
            }

            let (np, session) = poll_once(
                &manager,
                &mut last_track_key,
                &mut cached_art,
                &mut last_diag_signature,
                &mut last_aumid,
                &mut subscribed_aumid,
                &wake,
            );
            active_session = session;
            if let Ok(mut guard) = snapshot.lock() {
                *guard = np;
            }

            let sleep_ms = if wake.swap(false, Ordering::AcqRel) {
                150
            } else if active_session.is_some() {
                450
            } else {
                1000
            };
            thread::sleep(Duration::from_millis(sleep_ms));
        }
    }

    fn snapshot_handle() -> Arc<Mutex<NowPlaying>> {
        SNAPSHOT
            .get_or_init(|| Arc::new(Mutex::new(NowPlaying::default())))
            .clone()
    }

    fn worker_tx() -> &'static SyncSender<WorkerMsg> {
        WORKER_TX.get_or_init(|| {
            let (tx, rx) = mpsc::sync_channel(8);
            let snap = snapshot_handle();
            thread::Builder::new()
                .name("constellation-smtc".into())
                .spawn(move || worker_main(rx, snap))
                .expect("failed to spawn smtc worker");
            tx
        })
    }

    pub fn start_smtc_service() {
        let _ = worker_tx();
    }

    pub fn read_now_playing() -> Result<NowPlaying, SmtcError> {
        start_smtc_service();
        let snap = snapshot_handle();
        snap.lock()
            .map(|g| g.clone())
            .map_err(|e| SmtcError::Message(e.to_string()))
    }

    fn send_control(msg: WorkerMsg) -> Result<(), SmtcError> {
        start_smtc_service();
        worker_tx()
            .send(msg)
            .map_err(|e| SmtcError::Message(e.to_string()))
    }

    pub fn media_play_pause() -> Result<(), SmtcError> {
        send_control(WorkerMsg::PlayPause)
    }

    pub fn media_next() -> Result<(), SmtcError> {
        send_control(WorkerMsg::Next)
    }

    pub fn media_previous() -> Result<(), SmtcError> {
        send_control(WorkerMsg::Previous)
    }

    pub fn media_seek_ms(position_ms: u64) -> Result<(), SmtcError> {
        send_control(WorkerMsg::Seek(position_ms))
    }
}

#[cfg(windows)]
pub use win::{
    media_next, media_play_pause, media_previous, media_seek_ms, read_now_playing,
    start_smtc_service,
};
