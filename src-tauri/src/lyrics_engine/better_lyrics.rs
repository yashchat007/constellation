use crate::lyrics::{score_provider_match, LyricsError};
use crate::lyrics_engine::ttml::ttml_to_lines;
use crate::lyrics_engine::types::{ProviderSuccess, TimingQuality, TrackQuery};
use reqwest::blocking::Client;
use serde::Deserialize;
use std::time::Instant;

#[derive(Debug, Deserialize)]
struct BetterLyricsResponse {
    ttml: String,
}

pub fn fetch_better_lyrics(
    client: &Client,
    query: &TrackQuery,
    artist: &str,
    title: &str,
) -> Result<ProviderSuccess, LyricsError> {
    let started = Instant::now();
    let album = if query.album.is_empty() {
        "Unknown"
    } else {
        query.album.as_str()
    };
    let duration = query
        .duration_ms
        .map(|d| (d / 1000).max(1))
        .unwrap_or(180);
    let url = "https://api.betterlyrics.org/getLyrics";
    let resp = client
        .get(url)
        .query(&[
            ("s", title),
            ("a", artist),
            ("al", album),
            ("d", &duration.to_string()),
        ])
        .header(
            "User-Agent",
            "Constellation/0.1 (https://github.com/yashchat007/constellation)",
        )
        .send()
        .map_err(|e| {
            crate::lyrics_engine::circuit::record_outage("better_lyrics");
            LyricsError::Connectivity(format!("better_lyrics connection: {e}"))
        })?;
    let status = resp.status().as_u16();
    if status == 404 {
        return Err(LyricsError::NotFound("better_lyrics: not cached".into()));
    }
    if status == 401 {
        return Err(LyricsError::NotFound(
            "better_lyrics: miss (needs cache key with album/duration)".into(),
        ));
    }
    if status == 429 {
        return Err(LyricsError::RateLimit("better_lyrics rate limit".into()));
    }
    if status >= 500 {
        crate::lyrics_engine::circuit::record_outage("better_lyrics");
        return Err(LyricsError::Transient(format!(
            "better_lyrics HTTP {status}"
        )));
    }
    if status != 200 {
        return Err(LyricsError::Parse(format!("better_lyrics HTTP {status}")));
    }
    let body: BetterLyricsResponse = resp.json().map_err(|e| {
        LyricsError::Parse(format!("better_lyrics json: {e}"))
    })?;
    if !body.ttml.contains("<span") {
        return Err(LyricsError::Parse("better_lyrics: ttml missing spans".into()));
    }
    let lines = ttml_to_lines(&body.ttml)?;
    if lines.is_empty() {
        return Err(LyricsError::NotFound("better_lyrics: no lines".into()));
    }
    let titles: Vec<&str> = query.title_candidates();
    let scores = score_provider_match(
        &query.normalized_artist,
        &titles,
        artist,
        title,
    );
    if !scores.accepted {
        return Err(LyricsError::NotFound(format!(
            "better_lyrics: validation rejected ({})",
            scores.reason
        )));
    }
    let result = crate::lyrics::build_document_from_timed_lines(
        lines,
        "better_lyrics",
        query.track_key.clone(),
        true,
    )?;
    crate::lyrics_engine::circuit::record_success("better_lyrics");
    Ok(ProviderSuccess {
        result,
        provider: "better_lyrics",
        format: "ttml",
        timing: TimingQuality::Word,
        http_status: status,
        duration_ms: started.elapsed().as_millis() as u64,
    })
}
