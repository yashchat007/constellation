use crate::lyrics::{lookup_variants, poll_fetch_lifecycle, LyricsError, LyricsFetchDiagnostics};
use crate::lyrics_engine::better_lyrics::fetch_better_lyrics;
use crate::lyrics_engine::circuit::provider_available;
use crate::lyrics_engine::karalyr::fetch_karalyr;
use crate::lyrics_engine::lrcmux::fetch_lrcmux;
use crate::lyrics_engine::types::{ProviderSuccess, TrackQuery};
use reqwest::blocking::Client;
use std::time::Instant;

const PROVIDER_TIMEOUT_SECS: u64 = 12;

fn should_try_next(err: &LyricsError) -> bool {
    matches!(
        err,
        LyricsError::NotFound(_)
            | LyricsError::Transient(_)
            | LyricsError::Connectivity(_)
            | LyricsError::RateLimit(_)
    )
}

fn apply_provider_diag(diag: &mut LyricsFetchDiagnostics, success: &ProviderSuccess) {
    diag.last_stage = format!("provider:{}", success.provider);
    diag.last_http_status = Some(success.http_status);
    diag.last_error_class = "ok".into();
    diag.last_rejection_reason.clear();
    diag.provider_query_ms = success.duration_ms;
    diag.final_provider = success.provider.to_string();
    diag.lyrics_format = success.format.to_string();
    diag.timing_quality = success.timing.as_str().to_string();
}

fn record_attempt(diag: &mut LyricsFetchDiagnostics, provider: &str, err: &LyricsError) {
    diag.last_stage = format!("provider:{provider}");
    diag.fallback_reason = err.diagnostics_class().to_string();
    if let LyricsError::Parse(msg) = err {
        diag.last_rejection_reason = msg.clone();
    } else if let LyricsError::NotFound(msg) = err {
        diag.last_rejection_reason = msg.clone();
    }
}

type ProviderFn = fn(
    &Client,
    &TrackQuery,
    &str,
    &str,
) -> Result<ProviderSuccess, LyricsError>;

const FALLBACK_CHAIN: &[(&str, ProviderFn)] = &[
    ("lrcmux", fetch_lrcmux),
    ("better_lyrics", fetch_better_lyrics),
    ("karalyr", fetch_karalyr),
];

/// Try alternate providers after LRCLIB misses or hits a retryable outage.
pub fn fetch_alternate_providers(
    client: &Client,
    query: &TrackQuery,
    request_id: u64,
    deadline: Instant,
    diag: &mut LyricsFetchDiagnostics,
) -> Result<Option<ProviderSuccess>, LyricsError> {
    let variants = lookup_variants(&query.raw_artist, &query.raw_title);
    let max_variants = if variants.len() > 4 { 4 } else { variants.len() };

    for (provider_name, fetch_fn) in FALLBACK_CHAIN {
        if !provider_available(provider_name) {
            diag.fallback_reason = format!("circuit_open:{provider_name}");
            continue;
        }
        diag.current_provider = provider_name.to_string();

        for (a, t) in variants.iter().take(max_variants) {
            poll_fetch_lifecycle(request_id, deadline)?;
            diag.last_variant_artist = a.clone();
            diag.last_variant_title = t.clone();

            let provider_deadline = Instant::now() + std::time::Duration::from_secs(PROVIDER_TIMEOUT_SECS);
            if provider_deadline > deadline {
                // Respect overall fetch deadline.
            }

            match fetch_fn(client, query, a, t) {
                Ok(success) => {
                    apply_provider_diag(diag, &success);
                    return Ok(Some(success));
                }
                Err(e @ LyricsError::Cancelled(_)) => return Err(e),
                Err(e) => {
                    record_attempt(diag, provider_name, &e);
                    if should_try_next(&e) {
                        continue;
                    }
                    return Err(e);
                }
            }
        }
    }
    Ok(None)
}

/// Full provider chain entry: LRCLIB attempt supplied by caller, then fallbacks.
pub fn fetch_with_provider_chain(
    client: &Client,
    query: &TrackQuery,
    request_id: u64,
    deadline: Instant,
    diag: &mut LyricsFetchDiagnostics,
    lrclib: impl FnOnce() -> Result<Option<ProviderSuccess>, LyricsError>,
) -> Result<Option<ProviderSuccess>, LyricsError> {
    diag.current_provider = "lrclib".into();
    match lrclib()? {
        Some(success) => {
            apply_provider_diag(diag, &success);
            return Ok(Some(success));
        }
        None => {
            diag.fallback_reason = "lrclib_not_found".into();
        }
    }
    fetch_alternate_providers(client, query, request_id, deadline, diag)
}
