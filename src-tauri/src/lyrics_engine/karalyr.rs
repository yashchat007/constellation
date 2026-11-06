use crate::lyrics::{parse_lrc, score_provider_match, LyricsError};
use crate::lyrics_engine::types::{ProviderSuccess, TimingQuality, TrackQuery};
use reqwest::blocking::Client;
use serde::Deserialize;
use std::time::Instant;

fn base_url() -> String {
    std::env::var("CONSTELLATION_KARALYR_BASE").unwrap_or_else(|_| "https://karalyr.com".into())
}

#[derive(Debug, Deserialize)]
struct KaralyrGetResponse {
    track_name: Option<String>,
    artist_name: Option<String>,
    synced_lyrics: Option<String>,
    plain_lyrics: Option<String>,
}

pub fn fetch_karalyr(
    client: &Client,
    query: &TrackQuery,
    artist: &str,
    title: &str,
) -> Result<ProviderSuccess, LyricsError> {
    let started = Instant::now();
    let url = format!("{}/api/get", base_url());
    let mut req = client
        .get(&url)
        .query(&[
            ("artist_name", artist),
            ("track_name", title),
        ])
        .header(
            "User-Agent",
            "Constellation/0.1 (https://github.com/yashchat007/constellation)",
        );
    if let Some(d) = query.duration_ms {
        let secs = (d / 1000).max(1);
        req = req.query(&[("duration", secs.to_string())]);
    }
    let resp = req.send().map_err(|e| {
        crate::lyrics_engine::circuit::record_outage("karalyr");
        LyricsError::Connectivity(format!("karalyr connection: {e}"))
    })?;
    let status = resp.status().as_u16();
    if status == 404 {
        return Err(LyricsError::NotFound("karalyr: not in catalog".into()));
    }
    if status == 429 {
        return Err(LyricsError::RateLimit("karalyr rate limit".into()));
    }
    if status >= 500 {
        crate::lyrics_engine::circuit::record_outage("karalyr");
        return Err(LyricsError::Transient(format!("karalyr HTTP {status}")));
    }
    if status != 200 {
        return Err(LyricsError::Parse(format!("karalyr HTTP {status}")));
    }
    let body: KaralyrGetResponse = resp.json().map_err(|e| {
        LyricsError::Parse(format!("karalyr json: {e}"))
    })?;
    let fa = body.artist_name.as_deref().unwrap_or(artist);
    let ft = body.track_name.as_deref().unwrap_or(title);
    let titles: Vec<&str> = query.title_candidates();
    let scores = score_provider_match(&query.normalized_artist, &titles, fa, ft);
    if !scores.accepted {
        return Err(LyricsError::NotFound(format!(
            "karalyr: validation rejected ({})",
            scores.reason
        )));
    }
    let lrc = body
        .synced_lyrics
        .as_ref()
        .filter(|s| !s.trim().is_empty())
        .or(body.plain_lyrics.as_ref().filter(|s| !s.trim().is_empty()))
        .ok_or_else(|| LyricsError::NotFound("karalyr: empty lyrics".into()))?;
    let synced = body.synced_lyrics.is_some();
    let raw = parse_lrc(lrc)?;
    let timing = if synced {
        TimingQuality::Line
    } else {
        TimingQuality::Estimated
    };
    let result = if synced {
        crate::lyrics::build_document_no_romanize(raw, "karalyr", query.track_key.clone(), true)?
    } else {
        crate::lyrics::build_document_no_romanize(raw, "karalyr", query.track_key.clone(), false)?
    };
    crate::lyrics_engine::circuit::record_success("karalyr");
    Ok(ProviderSuccess {
        result,
        provider: "karalyr",
        format: "lrc",
        timing,
        http_status: status,
        duration_ms: started.elapsed().as_millis() as u64,
    })
}
