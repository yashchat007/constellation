use crate::lyrics::{
    score_provider_match, LyricLine, LyricWord, LyricsError,
};
use crate::lyrics_engine::types::{ProviderSuccess, TimingQuality, TrackQuery};
use reqwest::blocking::Client;
use serde::Deserialize;
use std::time::Instant;

fn base_url() -> String {
    std::env::var("CONSTELLATION_LRCMUX_BASE").unwrap_or_else(|_| "https://api.lrcmux.dev".into())
}

#[derive(Debug, Deserialize)]
struct LrcmuxWord {
    text: String,
    start: i64,
    end: i64,
}

#[derive(Debug, Deserialize)]
struct LrcmuxLine {
    text: String,
    start: Option<i64>,
    end: Option<i64>,
    words: Option<Vec<LrcmuxWord>>,
}

#[derive(Debug, Deserialize)]
struct LrcmuxTrack {
    title: String,
    artist: String,
}

#[derive(Debug, Deserialize)]
struct LrcmuxMeta {
    level: String,
    source: Option<LrcmuxSource>,
}

#[derive(Debug, Deserialize)]
struct LrcmuxSource {
    id: String,
}

#[derive(Debug, Deserialize)]
struct LrcmuxResponse {
    track: LrcmuxTrack,
    meta: LrcmuxMeta,
    lines: Vec<LrcmuxLine>,
}

pub fn fetch_lrcmux(
    client: &Client,
    query: &TrackQuery,
    artist: &str,
    title: &str,
) -> Result<ProviderSuccess, LyricsError> {
    let started = Instant::now();
    let duration_secs = query.duration_ms.map(|d| (d / 1000).max(1));
    let url = format!("{}/get", base_url());
    let mut req = client
        .get(&url)
        .query(&[
            ("format", "json"),
            ("artist", artist),
            ("title", title),
            ("level", "word"),
        ])
        .header(
            "User-Agent",
            "Constellation/0.1 (https://github.com/yashchat007/constellation)",
        );
    if !query.album.is_empty() {
        req = req.query(&[("album", query.album.as_str())]);
    }
    if let Some(d) = duration_secs {
        req = req.query(&[("duration", d.to_string())]);
    }
    let resp = req.send().map_err(|e| {
        crate::lyrics_engine::circuit::record_outage("lrcmux");
        LyricsError::Connectivity(format!("lrcmux connection: {e}"))
    })?;
    let status = resp.status().as_u16();
    if status == 404 {
        return Err(LyricsError::NotFound("lrcmux: no lyrics".into()));
    }
    if status == 429 {
        return Err(LyricsError::RateLimit("lrcmux rate limit".into()));
    }
    if status >= 500 {
        crate::lyrics_engine::circuit::record_outage("lrcmux");
        return Err(LyricsError::Transient(format!(
            "lrcmux HTTP {status}"
        )));
    }
    if !status.to_string().starts_with('2') {
        return Err(LyricsError::Parse(format!("lrcmux HTTP {status}")));
    }
    let body: LrcmuxResponse = resp.json().map_err(|e| {
        LyricsError::Parse(format!("lrcmux json: {e}"))
    })?;
    let titles: Vec<&str> = query.title_candidates();
    let scores = score_provider_match(
        &query.normalized_artist,
        &titles,
        &body.track.artist,
        &body.track.title,
    );
    if !scores.accepted {
        return Err(LyricsError::NotFound(format!(
            "lrcmux: validation rejected ({})",
            scores.reason
        )));
    }
    let timing = match body.meta.level.as_str() {
        "word" => TimingQuality::Word,
        "line" => TimingQuality::Line,
        _ => TimingQuality::None,
    };
    let mut out_lines: Vec<LyricLine> = Vec::new();
    for ln in body.lines {
        let start_ms = ln.start.unwrap_or(0).max(0) as u64;
        let end_ms = ln.end.unwrap_or(start_ms as i64 + 2000).max(start_ms as i64 + 1) as u64;
        let words: Vec<LyricWord> = if let Some(ws) = ln.words {
            ws.into_iter()
                .filter(|w| !w.text.trim().is_empty())
                .map(|w| LyricWord {
                    start_ms: w.start.max(0) as u64,
                    end_ms: w.end.max(w.start + 1) as u64,
                    text: w.text,
                    estimated: false,
                })
                .collect()
        } else {
            Vec::new()
        };
        out_lines.push(LyricLine {
            start_ms,
            end_ms,
            text: ln.text,
            words,
        });
    }
    if out_lines.is_empty() {
        return Err(LyricsError::NotFound("lrcmux: empty lines".into()));
    }
    let synced = timing != TimingQuality::None;
    let result = crate::lyrics::build_document_from_timed_lines(
        out_lines,
        "lrcmux",
        query.track_key.clone(),
        synced,
    )?;
    crate::lyrics_engine::circuit::record_success("lrcmux");
    Ok(ProviderSuccess {
        result,
        provider: "lrcmux",
        format: "json",
        timing,
        http_status: status,
        duration_ms: started.elapsed().as_millis() as u64,
    })
}
