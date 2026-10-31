use crate::transliterate::{contains_devanagari, romanize_display_text, romanize_for_matching};
use regex::Regex;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum LyricsError {
    #[error("lyrics not found: {0}")]
    NotFound(String),
    #[error("LRCLIB temporary outage: {0}")]
    Transient(String),
    #[error("LRCLIB rate limit: {0}")]
    RateLimit(String),
    #[error("connection error: {0}")]
    Connectivity(String),
    #[error("lyrics fetch busy: {0}")]
    Busy(String),
    #[error("lyrics fetch cancelled: {0}")]
    Cancelled(String),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("parse error: {0}")]
    Parse(String),
}

impl LyricsError {
    pub fn diagnostics_class(&self) -> &'static str {
        match self {
            LyricsError::NotFound(_) => "not_found",
            LyricsError::Transient(_) => "transient",
            LyricsError::RateLimit(_) => "rate_limit",
            LyricsError::Connectivity(_) => "connectivity",
            LyricsError::Busy(_) => "busy",
            LyricsError::Cancelled(_) => "cancelled",
            LyricsError::Parse(_) => "parse",
            LyricsError::Io(_) => "io",
        }
    }

    fn is_retryable_outage(&self) -> bool {
        matches!(
            self,
            LyricsError::Transient(_) | LyricsError::RateLimit(_) | LyricsError::Connectivity(_)
        )
    }
}

fn lrclib_api_root() -> String {
    #[cfg(test)]
    {
        if let Some(base) = test_lrclib_base_override() {
            return base;
        }
    }
    std::env::var("CONSTELLATION_LRCLIB_BASE")
        .unwrap_or_else(|_| LRCLIB_API_ROOT_DEFAULT.to_string())
}

#[cfg(test)]
fn test_lrclib_base_override() -> Option<String> {
    TEST_LRCLIB_BASE.with(|cell| cell.borrow().clone())
}

#[cfg(test)]
fn set_test_lrclib_base(base: Option<String>) {
    TEST_LRCLIB_BASE.with(|cell| *cell.borrow_mut() = base);
}

#[cfg(test)]
thread_local! {
    static TEST_LRCLIB_BASE: std::cell::RefCell<Option<String>> = const { std::cell::RefCell::new(None) };
}

const CACHE_SCHEMA_VERSION: u32 = 3;
const FETCH_DEADLINE_SECS: u64 = 28;
const LRCLIB_API_ROOT_DEFAULT: &str = "https://lrclib.net";

static SHARED_HTTP_CLIENT: LazyLock<Result<reqwest::blocking::Client, String>> =
    LazyLock::new(|| {
        reqwest::blocking::Client::builder()
            .user_agent("Constellation/0.1 (Windows; personal project)")
            .timeout(Duration::from_secs(10))
            .connect_timeout(Duration::from_secs(5))
            .pool_max_idle_per_host(2)
            .build()
            .map_err(|e| e.to_string())
    });

/// Latest lyrics fetch request id from the frontend; older in-flight work must exit.
static ACTIVE_FETCH_REQUEST: AtomicU64 = AtomicU64::new(0);

fn lyrics_log(msg: impl AsRef<str>) {
    if cfg!(debug_assertions) || std::env::var_os("CONSTELLATION_LOG").is_some() {
        eprintln!("[constellation:lyrics] {}", msg.as_ref());
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricWord {
    pub start_ms: u64,
    pub end_ms: u64,
    pub text: String,
    pub estimated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricLine {
    pub start_ms: u64,
    pub end_ms: u64,
    pub text: String,
    pub words: Vec<LyricWord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricsResult {
    pub lines: Vec<LyricLine>,
    pub source: String,
    pub track_key: String,
    pub synced: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LrcLibGetResponse {
    track_name: Option<String>,
    artist_name: Option<String>,
    synced_lyrics: Option<String>,
    plain_lyrics: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LrcLibSearchHit {
    track_name: Option<String>,
    artist_name: Option<String>,
    duration: Option<f64>,
    synced_lyrics: Option<String>,
    plain_lyrics: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LyricsCacheFile {
    #[serde(default)]
    schema_version: u32,
    track_key: String,
    not_found: bool,
    cached_at_ms: u64,
    result: Option<LyricsResult>,
}

const NEGATIVE_CACHE_TTL_MS: u64 = 6 * 60 * 60 * 1000;

fn track_key(artist: &str, title: &str, duration_ms: Option<u64>) -> String {
    let mut hasher = Sha256::new();
    hasher.update(artist.trim().to_lowercase().as_bytes());
    hasher.update(b"|");
    hasher.update(title.trim().to_lowercase().as_bytes());
    if let Some(d) = duration_ms {
        hasher.update(d.to_string().as_bytes());
    }
    hex::encode(hasher.finalize())
}

fn cache_path(cache_dir: &Path, key: &str) -> PathBuf {
    cache_dir.join(format!("{key}.json"))
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::ZERO)
        .as_millis() as u64
}

fn read_cache(cache_dir: &Path, key: &str) -> Option<LyricsCacheFile> {
    let path = cache_path(cache_dir, key);
    let data = fs::read_to_string(path).ok()?;
    let cache: LyricsCacheFile = serde_json::from_str(&data).ok()?;
    if cache.schema_version != CACHE_SCHEMA_VERSION {
        lyrics_log(format!(
            "ignoring stale cache file (schema {} != {})",
            cache.schema_version, CACHE_SCHEMA_VERSION
        ));
        return None;
    }
    Some(cache)
}

fn write_cache(cache_dir: &Path, key: &str, file: &LyricsCacheFile) {
    if let Ok(json) = serde_json::to_string_pretty(file) {
        let _ = fs::write(cache_path(cache_dir, key), json);
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LyricsFetchDiagnostics {
    pub track_key: String,
    pub normalized_artist: String,
    pub normalized_title: String,
    pub language_hint: String,
    pub variant_count: u32,
    pub last_variant_artist: String,
    pub last_variant_title: String,
    pub last_http_status: Option<u16>,
    pub last_error_class: String,
    pub cache_hit: String,
    pub transliteration_sample: String,
    #[serde(default)]
    pub last_stage: String,
    #[serde(default)]
    pub search_hit_count: u32,
    #[serde(default)]
    pub get_attempts: u32,
    #[serde(default)]
    pub last_rejection_reason: String,
}

static LAST_LYRICS_DIAG: Mutex<Option<LyricsFetchDiagnostics>> = Mutex::new(None);

fn register_fetch_request(request_id: u64) {
    if request_id > 0 {
        ACTIVE_FETCH_REQUEST.fetch_max(request_id, Ordering::SeqCst);
    }
}

fn fetch_request_active(request_id: u64) -> bool {
    if request_id == 0 {
        return true;
    }
    ACTIVE_FETCH_REQUEST.load(Ordering::SeqCst) == request_id
}

fn ensure_fetch_active(request_id: u64) -> Result<(), LyricsError> {
    if fetch_request_active(request_id) {
        Ok(())
    } else {
        Err(LyricsError::Cancelled(
            "superseded by a newer track lyrics request".into(),
        ))
    }
}

fn poll_fetch_lifecycle(request_id: u64, deadline: Instant) -> Result<(), LyricsError> {
    ensure_fetch_active(request_id)?;
    if Instant::now() >= deadline {
        return Err(LyricsError::Transient(
            "lyrics fetch deadline exceeded before LRCLIB responded".into(),
        ));
    }
    Ok(())
}

fn shared_http_client() -> Result<&'static reqwest::blocking::Client, LyricsError> {
    SHARED_HTTP_CLIENT
        .as_ref()
        .map_err(|e| LyricsError::Connectivity(e.clone()))
        .map(|c| c as _)
}

pub fn get_lyrics_fetch_diagnostics() -> Option<LyricsFetchDiagnostics> {
    LAST_LYRICS_DIAG.lock().ok()?.clone()
}

fn set_lyrics_diag(diag: LyricsFetchDiagnostics) {
    if let Ok(mut g) = LAST_LYRICS_DIAG.lock() {
        *g = Some(diag);
    }
}

fn language_hint(title: &str, artist: &str) -> String {
    if contains_devanagari(title) || contains_devanagari(artist) {
        "hindi-devanagari".into()
    } else {
        "latin".into()
    }
}

/// First segment of YouTube pipe titles: `Song - Film Version | Movie | …`
pub fn extract_primary_streaming_head(title: &str) -> String {
    title.split('|').next().unwrap_or(title).trim().to_string()
}

static STREAMING_SUFFIX: &[&str] = &[
    "film version",
    "official video",
    "official music video",
    "official audio",
    "official lyric video",
    "lyric video",
    "full video",
    "video song",
    "audio song",
    "4k video",
    "8k video",
];

pub fn strip_streaming_version_suffix(head: &str) -> String {
    let mut s = head.trim().to_string();
    let lower = s.to_lowercase();
    for noise in STREAMING_SUFFIX {
        if let Some(idx) = lower.rfind(noise) {
            let prefix = s[..idx].trim().trim_end_matches('-').trim();
            if !prefix.is_empty() {
                s = prefix.to_string();
            }
        }
    }
    s.trim().to_string()
}

pub fn primary_song_title_from_head(head: &str) -> String {
    let stripped = strip_streaming_version_suffix(head);
    if let Some((left, right)) = stripped.split_once(" - ") {
        let left = left.trim();
        let right = right.trim().to_lowercase();
        if STREAMING_SUFFIX.iter().any(|n| right.contains(n)) && !left.is_empty() {
            return left.to_string();
        }
    }
    stripped
}

pub fn pipe_credit_names(title: &str) -> Vec<String> {
    title
        .split('|')
        .skip(1)
        .flat_map(|seg| seg.split(&[',', '&'][..]))
        .map(|s| s.trim())
        .filter(|s| {
            let len = s.len();
            len >= 2
                && len <= 48
                && !s.eq_ignore_ascii_case("brahmastra")
                && !s.eq_ignore_ascii_case("film")
        })
        .map(|s| s.to_string())
        .collect()
}

fn expand_playback_credit(name: &str) -> Vec<String> {
    let n = name.trim();
    if n.is_empty() {
        return Vec::new();
    }
    let lower = n.to_lowercase();
    let mut out = vec![n.to_string()];
    match lower.as_str() {
        "arijit" => out.push("Arijit Singh".into()),
        "amitabh" => out.push("Amitabh Bhattacharya".into()),
        "pritam" => out.push("Pritam".into()),
        "alia" | "ranbir" => {}
        _ => {}
    }
    out.sort();
    out.dedup();
    out
}

pub fn clean_video_title(title: &str) -> String {
    let head = extract_primary_streaming_head(title);
    let head = strip_streaming_version_suffix(&head);
    let primary = primary_song_title_from_head(&head);
    static NOISE: &[&str] = &[
        "official video",
        "official music video",
        "official audio",
        "official lyric video",
        "lyrics video",
        "lyrics",
        "official",
        "hd",
        "4k",
        "8k",
        "vevo",
    ];
    static PAREN_LABELS: &[&str] = &[
        "official",
        "official video",
        "official music video",
        "official audio",
        "official lyric video",
        "lyric video",
        "lyrics video",
        "lyrics",
        "visualizer",
        "audio",
        "video",
        "vevo",
    ];
    let paren_re = Regex::new(r"\s*[\(\[][^\)\]]*[\)\]]\s*").unwrap();
    let mut s = primary.clone();
    for _ in 0..4 {
        let next = paren_re.replace_all(&s, |caps: &regex::Captures| {
            let inner = caps
                .get(0)
                .map(|m| {
                    m.as_str()
                        .trim_matches(|c| c == '(' || c == ')' || c == '[' || c == ']')
                        .trim()
                        .to_lowercase()
                })
                .unwrap_or_default();
            if PAREN_LABELS
                .iter()
                .any(|label| inner == *label || inner.contains(label))
            {
                " ".to_string()
            } else {
                caps.get(0).map(|m| m.as_str()).unwrap_or(" ").to_string()
            }
        });
        if next.as_ref() == s {
            break;
        }
        s = next.into_owned();
    }
    let re = Regex::new(r"\s*[\(\[][^\)\]]*[\)\]]\s*").unwrap();
    s = re.replace_all(&s, " ").to_string();
    s = Regex::new(r"\s+")
        .unwrap()
        .replace_all(&s, " ")
        .trim()
        .to_string();
    let lower = s.to_lowercase();
    for noise in NOISE {
        if lower.ends_with(noise) {
            let cut = s.len().saturating_sub(noise.len());
            s = s[..cut].trim().to_string();
        }
    }
    s.trim().trim_matches('-').trim().to_string()
}

pub fn normalize_for_match(input: &str) -> String {
    let romanized = romanize_for_matching(input);
    let lower = romanized
        .to_lowercase()
        .replace('\u{2019}', "'")
        .replace('\u{2018}', "'")
        .replace('`', "'");
    let re_feat = Regex::new(r"\s*(feat\.?|ft\.?|featuring)\s+.*$").unwrap();
    let no_feat = re_feat.replace(&lower, "");
    let no_apostrophe = no_feat
        .replace("'s", "s")
        .replace(['\'', '\u{2019}', '\u{2018}'], "");
    let re_punct = Regex::new(r"[^a-z0-9\s]").unwrap();
    let cleaned = re_punct.replace_all(&no_apostrophe, " ");
    Regex::new(r"\s+")
        .unwrap()
        .replace_all(cleaned.trim(), " ")
        .to_string()
}

pub fn similarity(a: &str, b: &str) -> f32 {
    let a = normalize_for_match(a);
    let b = normalize_for_match(b);
    if a.is_empty() || b.is_empty() {
        return 0.0;
    }
    if a == b {
        return 1.0;
    }
    if a.contains(&b) || b.contains(&a) {
        return 0.92;
    }
    let a_tokens: HashSet<_> = a.split_whitespace().collect();
    let b_tokens: HashSet<_> = b.split_whitespace().collect();
    if a_tokens.is_empty() || b_tokens.is_empty() {
        return 0.0;
    }
    let inter = a_tokens.intersection(&b_tokens).count();
    let union = a_tokens.union(&b_tokens).count();
    inter as f32 / union as f32
}

pub fn validate_lrclib_match(
    query_artist: &str,
    query_title: &str,
    found_artist: &str,
    found_title: &str,
) -> bool {
    let title_score = similarity(query_title, found_title);
    let artist_score = if query_artist.trim().is_empty() {
        0.75
    } else {
        let direct = similarity(query_artist, found_artist);
        let primary = similarity(&primary_credit(query_artist), found_artist);
        direct.max(primary)
    };
    title_score >= 0.55 && (artist_score >= 0.4 || title_score >= 0.82)
}

/// First billed name when SMTC/YouTube uses "A, B - Title".
pub fn primary_credit(artists: &str) -> String {
    artists
        .split(',')
        .next()
        .unwrap_or(artists)
        .trim()
        .to_string()
}

pub fn is_untrusted_media_artist(artist: &str) -> bool {
    let a = artist.trim();
    if a.is_empty() {
        return true;
    }
    let lower = a.to_lowercase();
    if lower.contains("vevo") {
        return true;
    }
    if lower.ends_with("topic") || lower.contains("- topic") {
        return true;
    }
    if lower.contains("official audio") || lower.contains("official video") {
        return true;
    }
    if lower.contains("records") && !a.contains(',') && a.len() < 28 {
        return true;
    }
    // Typical YouTube channel id: no spaces, mixed case (ShawnMendesVEVO).
    if !a.contains(' ') && a.len() >= 8 {
        let upper = a.chars().filter(|c| c.is_uppercase()).count();
        let lower_c = a.chars().filter(|c| c.is_lowercase()).count();
        if upper > 0 && lower_c > 0 && upper + lower_c >= a.len().saturating_sub(2) {
            return true;
        }
    }
    false
}

pub fn parse_title_artist_track(cleaned_title: &str) -> Option<(String, String)> {
    let t = cleaned_title.trim();
    if t.is_empty() {
        return None;
    }
    let (left, song) = t.rsplit_once(" - ")?;
    let left = left.trim();
    let song = song.trim();
    if left.is_empty() || song.is_empty() {
        return None;
    }
    Some((left.to_string(), song.to_string()))
}

/// Prefer SMTC artist when YouTube uses `Song Title - Artist Name`.
pub fn resolve_lrclib_metadata(raw_artist: &str, raw_title: &str) -> (String, String) {
    let cleaned_title = clean_video_title(raw_title);
    if let Some((left, right)) = cleaned_title.rsplit_once(" - ") {
        let left = left.trim();
        let right = right.trim();
        let smtc = raw_artist.trim();
        if !smtc.is_empty() && similarity(smtc, right) >= 0.55 {
            return (primary_credit(smtc), left.to_string());
        }
        if !smtc.is_empty() && similarity(smtc, left) >= 0.55 {
            return (primary_credit(smtc), right.to_string());
        }
    }
    normalize_lrclib_query(raw_artist, raw_title)
}

pub fn normalize_lrclib_query(artist: &str, title: &str) -> (String, String) {
    let cleaned_title = clean_video_title(title);
    let parsed = parse_title_artist_track(&cleaned_title);

    if is_untrusted_media_artist(artist) {
        if let Some((a, t)) = parsed {
            return (primary_credit(&a), t);
        }
        return (String::new(), cleaned_title);
    }

    if let Some((parsed_a, parsed_t)) = parsed.clone() {
        if !artist.trim().is_empty() && similarity(artist, &parsed_a) < 0.35 {
            return (primary_credit(&parsed_a), parsed_t);
        }
        if artist.trim().is_empty() {
            return (primary_credit(&parsed_a), parsed_t);
        }
    }

    if !artist.trim().is_empty() {
        return (artist.trim().to_string(), cleaned_title);
    }

    if let Some((a, t)) = parsed {
        return (primary_credit(&a), t);
    }
    (String::new(), cleaned_title)
}

pub fn lookup_variants(artist: &str, raw_title: &str) -> Vec<(String, String)> {
    let cleaned_full = clean_video_title(raw_title);
    let (artist, title) = resolve_lrclib_metadata(artist, raw_title);
    let short_title =
        primary_song_title_from_head(&extract_primary_streaming_head(raw_title));
    let mut out = Vec::new();
    let mut seen = HashSet::new();

    let mut push_pair = |a: String, t: String, latin_key: bool, spelling_key: bool| {
        let key = if spelling_key {
            format!("spell::{}::{}", a.trim(), t.trim())
        } else if latin_key {
            format!(
                "latin::{}::{}",
                a.trim().to_lowercase(),
                t.trim().to_lowercase()
            )
        } else {
            format!("{}::{}", normalize_for_match(&a), normalize_for_match(&t))
        };
        if seen.insert(key) && !t.trim().is_empty() {
            out.push((a, t));
        }
    };

    push_pair(artist.clone(), title.clone(), false, false);

    if !short_title.is_empty() {
        push_pair(String::new(), short_title.clone(), false, false);
        push_pair(artist.clone(), short_title.clone(), false, false);
        for credit in pipe_credit_names(raw_title) {
            for name in expand_playback_credit(&credit) {
                push_pair(name, short_title.clone(), false, false);
            }
        }
    }

    if let Some((full_artists, track_only)) = parse_title_artist_track(&cleaned_full) {
        push_pair(primary_credit(&full_artists), track_only.clone(), false, false);
        push_pair(full_artists, track_only, false, false);
    }

    let title_no_feat = Regex::new(r"\s*(feat\.?|ft\.?|featuring)\s+.*")
        .unwrap()
        .replace(&title, "")
        .trim()
        .to_string();
    push_pair(artist.clone(), title_no_feat, false, false);

    if artist.is_empty() {
        push_pair(String::new(), title.clone(), false, false);
    }

    push_pair(
        artist.clone(),
        title
            .split('-')
            .next()
            .unwrap_or(&title)
            .trim()
            .to_string(),
        false,
        false,
    );

    if contains_devanagari(&title) {
        push_pair(artist.clone(), romanize_for_matching(&title), true, false);
    }
    if contains_devanagari(&artist) {
        push_pair(romanize_for_matching(&artist), title.clone(), true, false);
    }
    if contains_devanagari(&title) && !artist.is_empty() {
        push_pair(
            romanize_for_matching(&artist),
            romanize_for_matching(&title),
            true,
            false,
        );
    }

    for apostrophe_title in apostrophe_title_variants(&title) {
        push_pair(artist.clone(), apostrophe_title, false, true);
    }
    for apostrophe_title in apostrophe_title_variants(&short_title) {
        if !short_title.is_empty() {
            push_pair(artist.clone(), apostrophe_title, false, true);
        }
    }

    out
}

/// e.g. `Harleys in Hawaii` → `Harley's in Hawaii` for LRCLIB title spelling.
pub fn apostrophe_title_variants(title: &str) -> Vec<String> {
    let mut out = Vec::new();
    let re = Regex::new(r"(?i)\b([A-Za-z]{3,})s(\s+)").unwrap();
    if let Some(caps) = re.captures(title) {
        let stem = caps.get(1).unwrap().as_str();
        let sep = caps.get(2).unwrap().as_str();
        let variant = re.replace(title, format!("{}'s{}", stem, sep));
        if variant.as_ref() != title {
            out.push(variant.into_owned());
        }
    }
    if title.contains('\'') {
        let no_apostrophe = title.replace("'s", "s").replace('\'', "");
        if no_apostrophe != title {
            out.push(no_apostrophe);
        }
    }
    out
}

fn duration_compatible(query_ms: Option<u64>, hit_secs: Option<f64>) -> bool {
    let Some(q) = query_ms.filter(|&v| v > 0) else {
        return true;
    };
    let Some(h) = hit_secs.filter(|&v| v.is_finite() && v > 0.0) else {
        return true;
    };
    let hit_ms = (h * 1000.0).round() as u64;
    let diff = q.abs_diff(hit_ms);
    diff <= 18_000 || (q > 0 && diff as f64 / q as f64 <= 0.07)
}

fn parse_timestamp(min: &str, sec: &str, frac: Option<&str>) -> u64 {
    let min: u64 = min.parse().unwrap_or(0);
    let sec: u64 = sec.parse().unwrap_or(0);
    let ms = match frac.unwrap_or("0").len() {
        0 => 0,
        1 => frac.unwrap().parse::<u64>().unwrap_or(0) * 100,
        2 => frac.unwrap().parse::<u64>().unwrap_or(0) * 10,
        _ => frac.unwrap().parse::<u64>().unwrap_or(0),
    };
    min * 60_000 + sec * 1000 + ms
}

pub fn is_metadata_tag(line: &str) -> bool {
    let trimmed = line.trim();
    if !trimmed.starts_with('[') {
        return false;
    }
    let re = Regex::new(r"^\[[a-zA-Z]+:").unwrap();
    re.is_match(trimmed)
}

pub fn parse_lrc(input: &str) -> Result<Vec<(u64, String)>, LyricsError> {
    let time_re = Regex::new(r"\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]").map_err(|e| {
        LyricsError::Parse(e.to_string())
    })?;

    let mut raw: Vec<(u64, String)> = Vec::new();

    for line in input.lines() {
        let line = line.trim();
        if line.is_empty() || is_metadata_tag(line) {
            continue;
        }

        let mut times: Vec<u64> = Vec::new();
        let mut last_end = 0usize;
        for cap in time_re.captures_iter(line) {
            if let Some(m) = cap.get(0) {
                let t = parse_timestamp(&cap[1], &cap[2], cap.get(3).map(|x| x.as_str()));
                times.push(t);
                last_end = m.end();
            }
        }

        if times.is_empty() {
            continue;
        }

        let text = line[last_end..].trim().to_string();
        if text.is_empty() {
            continue;
        }

        for t in times {
            raw.push((t, text.clone()));
        }
    }

    raw.sort_by_key(|(t, _)| *t);
    raw.dedup_by_key(|(t, text)| (*t, text.clone()));
    Ok(raw)
}

pub fn estimate_words(text: &str, start_ms: u64, end_ms: u64) -> Vec<LyricWord> {
    let words: Vec<&str> = text.split_whitespace().collect();
    if words.is_empty() {
        return Vec::new();
    }
    let span = end_ms.saturating_sub(start_ms).max(1);
    let step = span / words.len() as u64;
    words
        .iter()
        .enumerate()
        .map(|(i, w)| {
            let ws = start_ms + step * i as u64;
            let we = if i + 1 == words.len() {
                end_ms
            } else {
                start_ms + step * (i as u64 + 1)
            };
            LyricWord {
                start_ms: ws,
                end_ms: we,
                text: (*w).to_string(),
                estimated: true,
            }
        })
        .collect()
}

pub fn enrich_lines(raw: Vec<(u64, String)>) -> Vec<LyricLine> {
    if raw.is_empty() {
        return Vec::new();
    }
    let mut lines: Vec<LyricLine> = Vec::with_capacity(raw.len());
    for (i, (start_ms, text)) in raw.iter().enumerate() {
        let end_ms = raw
            .get(i + 1)
            .map(|(t, _)| *t)
            .unwrap_or(start_ms + 8000);
        let words = estimate_words(text, *start_ms, end_ms);
        lines.push(LyricLine {
            start_ms: *start_ms,
            end_ms,
            text: text.clone(),
            words,
        });
    }
    lines
}

pub fn build_document(
    raw: Vec<(u64, String)>,
    source: &str,
    track_key: String,
    synced: bool,
) -> Result<LyricsResult, LyricsError> {
    let mut lines = enrich_lines(raw);
    for line in &mut lines {
        if contains_devanagari(&line.text) {
            line.text = romanize_display_text(&line.text);
        }
        for w in &mut line.words {
            if contains_devanagari(&w.text) {
                w.text = romanize_display_text(&w.text);
            }
        }
    }
    if lines.is_empty() {
        return Err(LyricsError::NotFound("no lines after enrichment".into()));
    }
    Ok(LyricsResult {
        lines,
        source: source.to_string(),
        track_key,
        synced,
    })
}

fn lrc_from_lrclib(hit: &LrcLibGetResponse) -> Option<(String, bool)> {
    if let Some(synced) = hit.synced_lyrics.as_ref().filter(|s| !s.trim().is_empty()) {
        return Some((synced.clone(), true));
    }
    hit.plain_lyrics
        .as_ref()
        .filter(|s| !s.trim().is_empty())
        .map(|p| (p.clone(), false))
}

fn lrc_from_search_hit(hit: &LrcLibSearchHit) -> Option<(String, bool)> {
    if let Some(synced) = hit.synced_lyrics.as_ref().filter(|s| !s.trim().is_empty()) {
        return Some((synced.clone(), true));
    }
    hit.plain_lyrics
        .as_ref()
        .filter(|s| !s.trim().is_empty())
        .map(|p| (p.clone(), false))
}

fn is_transient_http(status: u16) -> bool {
    matches!(status, 429 | 502 | 503 | 504)
}

fn retry_delay_ms(attempt: u32) -> u64 {
    let base = 400u64.saturating_mul(1 << attempt.min(3));
    base.saturating_add(attempt as u64 * 137)
}

fn http_client() -> Result<reqwest::blocking::Client, LyricsError> {
    Ok(shared_http_client()?.clone())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LrclibConnectivityProbe {
    pub api_root: String,
    pub dns_ok: bool,
    pub get_status: Option<u16>,
    pub get_ms: Option<u64>,
    pub search_status: Option<u16>,
    pub search_ms: Option<u64>,
    pub get_error: String,
    pub search_error: String,
    pub parse_ok: bool,
}

pub fn probe_lrclib_connectivity() -> LrclibConnectivityProbe {
    let api_root = lrclib_api_root();
    let mut probe = LrclibConnectivityProbe {
        api_root: api_root.clone(),
        dns_ok: false,
        get_status: None,
        get_ms: None,
        search_status: None,
        search_ms: None,
        get_error: String::new(),
        search_error: String::new(),
        parse_ok: false,
    };
    let client = match shared_http_client() {
        Ok(c) => c.clone(),
        Err(e) => {
            probe.get_error = e.to_string();
            probe.search_error = probe.get_error.clone();
            return probe;
        }
    };
    probe.dns_ok = true;

    let get_started = Instant::now();
    match client
        .get(format!("{api_root}/api/get"))
        .query(&[
            ("artist_name", "Katy Perry"),
            ("track_name", "Harley's in Hawaii"),
        ])
        .send()
    {
        Ok(resp) => {
            probe.get_ms = Some(get_started.elapsed().as_millis() as u64);
            probe.get_status = Some(resp.status().as_u16());
            if resp.status().is_success() {
                probe.parse_ok = resp.json::<LrcLibGetResponse>().is_ok();
            }
        }
        Err(e) => probe.get_error = e.to_string(),
    }

    let search_started = Instant::now();
    match client
        .get(format!("{api_root}/api/search"))
        .query(&[
            ("artist_name", "Fifth Harmony"),
            ("track_name", "Worth It"),
        ])
        .send()
    {
        Ok(resp) => {
            probe.search_ms = Some(search_started.elapsed().as_millis() as u64);
            probe.search_status = Some(resp.status().as_u16());
        }
        Err(e) => probe.search_error = e.to_string(),
    }
    probe
}

fn lrclib_get_with_retry(
    client: &reqwest::blocking::Client,
    artist: &str,
    title: &str,
    duration_ms: Option<u64>,
    max_attempts: u32,
) -> Result<LrcLibGetResponse, LyricsError> {
    let mut last_err: Option<LyricsError> = None;
    for attempt in 0..max_attempts.max(1) {
        if attempt > 0 {
            let delay = retry_delay_ms(attempt - 1);
            lyrics_log(format!("LRCLIB GET retry {attempt} after {delay}ms"));
            std::thread::sleep(Duration::from_millis(delay));
        }
        match lrclib_get(client, artist, title, duration_ms) {
            Ok(body) => return Ok(body),
            Err(e @ (LyricsError::Transient(_) | LyricsError::RateLimit(_))) => {
                lyrics_log(format!("LRCLIB GET retryable: {e}"));
                last_err = Some(e);
            }
            Err(e @ LyricsError::Connectivity(_)) => {
                last_err = Some(e);
            }
            Err(e @ LyricsError::NotFound(_)) | Err(e @ LyricsError::Parse(_)) => return Err(e),
            Err(e) => return Err(e),
        }
    }
    Err(last_err.unwrap_or_else(|| {
        LyricsError::Transient("LRCLIB GET failed after retries (service may be unavailable)".into())
    }))
}

fn lrclib_get(
    client: &reqwest::blocking::Client,
    artist: &str,
    title: &str,
    duration_ms: Option<u64>,
) -> Result<LrcLibGetResponse, LyricsError> {
    lyrics_log(format!(
        "LRCLIB GET artist={artist:?} track={title:?} duration_ms={duration_ms:?}"
    ));
    let url = format!("{}/api/get", lrclib_api_root());
    let mut req = client
        .get(url)
        .query(&[
            ("artist_name", artist.trim()),
            ("track_name", title.trim()),
        ]);
    if let Some(d) = duration_ms {
        req = req.query(&[("duration", &(d / 1000).to_string())]);
    }
    let response = req.send().map_err(|e| {
        lyrics_log(format!("LRCLIB GET connection error: {e}"));
        LyricsError::Connectivity(e.to_string())
    })?;
    let status = response.status();
    lyrics_log(format!("LRCLIB GET HTTP {}", status));
    if status.as_u16() == 404 {
        return Err(LyricsError::NotFound("LRCLIB get returned 404".into()));
    }
    if status.as_u16() == 400 {
        return Err(LyricsError::NotFound(
            "LRCLIB get rejected query (400 bad request)".into(),
        ));
    }
    if status.as_u16() == 429 {
        let retry_after = response
            .headers()
            .get("retry-after")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("unknown");
        return Err(LyricsError::RateLimit(format!(
            "LRCLIB rate limit (429); retry-after={retry_after}"
        )));
    }
    if is_transient_http(status.as_u16()) || status.as_u16() == 500 {
        return Err(LyricsError::Transient(format!(
            "LRCLIB temporary outage (HTTP {status})"
        )));
    }
    if !status.is_success() {
        return Err(LyricsError::NotFound(format!(
            "LRCLIB get unexpected status {status}"
        )));
    }
    let body: LrcLibGetResponse = response.json().map_err(|e| {
        lyrics_log(format!("LRCLIB GET JSON parse error: {e}"));
        LyricsError::Parse(format!("LRCLIB GET response parse error: {e}"))
    })?;
    let synced_len = body
        .synced_lyrics
        .as_ref()
        .map(|s| s.len())
        .unwrap_or(0);
    let plain_len = body.plain_lyrics.as_ref().map(|s| s.len()).unwrap_or(0);
    lyrics_log(format!(
        "LRCLIB GET body artist={:?} track={:?} synced_len={synced_len} plain_len={plain_len}",
        body.artist_name, body.track_name
    ));
    Ok(body)
}

fn lrclib_search(
    client: &reqwest::blocking::Client,
    artist: &str,
    title: &str,
) -> Result<Vec<LrcLibSearchHit>, LyricsError> {
    lyrics_log(format!(
        "LRCLIB SEARCH artist={artist:?} track={title:?}"
    ));
    let response = client
        .get(format!("{}/api/search", lrclib_api_root()))
        .query(&[
            ("track_name", title.trim()),
            ("artist_name", artist.trim()),
        ])
        .send()
        .map_err(|e| {
            lyrics_log(format!("LRCLIB SEARCH connection error: {e}"));
            LyricsError::Connectivity(e.to_string())
        })?;
    lyrics_log(format!("LRCLIB SEARCH (track/artist) HTTP {}", response.status()));
    if response.status().is_success() {
        match response.json::<Vec<LrcLibSearchHit>>() {
            Ok(hits) => {
                lyrics_log(format!("LRCLIB SEARCH hits={}", hits.len()));
                if !hits.is_empty() {
                    return Ok(hits);
                }
            }
            Err(e) => {
                lyrics_log(format!("LRCLIB SEARCH JSON parse failed (track/artist): {e}"));
                return Err(LyricsError::Parse(format!(
                    "LRCLIB SEARCH response parse error: {e}"
                )));
            }
        }
    }

    let q = if artist.trim().is_empty() {
        title.trim().to_string()
    } else {
        format!("{} {}", artist.trim(), title.trim())
    };
    lyrics_log(format!("LRCLIB SEARCH q={q:?}"));
    let response = client
        .get(format!("{}/api/search", lrclib_api_root()))
        .query(&[("q", q.as_str())])
        .send()
        .map_err(|e| LyricsError::Connectivity(e.to_string()))?;
    lyrics_log(format!("LRCLIB SEARCH (q) HTTP {}", response.status()));
    if response.status().as_u16() == 429 {
        let retry_after = response
            .headers()
            .get("retry-after")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("unknown");
        return Err(LyricsError::RateLimit(format!(
            "LRCLIB rate limit (429); retry-after={retry_after}"
        )));
    }
    let search_status = response.status().as_u16();
    if search_status == 400 {
        return Err(LyricsError::NotFound(
            "LRCLIB search rejected query (400)".into(),
        ));
    }
    if is_transient_http(search_status) || search_status == 500 {
        return Err(LyricsError::Transient(format!(
            "LRCLIB search temporary outage (HTTP {search_status})"
        )));
    }
    if !response.status().is_success() {
        return Err(LyricsError::NotFound(format!(
            "LRCLIB search status {}",
            response.status()
        )));
    }
    let hits: Vec<LrcLibSearchHit> = response.json().map_err(|e| {
        lyrics_log(format!("LRCLIB SEARCH JSON parse error: {e}"));
        LyricsError::Parse(format!("LRCLIB SEARCH response parse error: {e}"))
    })?;
    lyrics_log(format!("LRCLIB SEARCH (q) hits={}", hits.len()));
    Ok(hits)
}

fn lrclib_search_with_retry(
    client: &reqwest::blocking::Client,
    artist: &str,
    title: &str,
    max_attempts: u32,
) -> Result<Vec<LrcLibSearchHit>, LyricsError> {
    let mut last_err: Option<LyricsError> = None;
    for attempt in 0..max_attempts.max(1) {
        if attempt > 0 {
            let delay = retry_delay_ms(attempt - 1);
            lyrics_log(format!("LRCLIB SEARCH retry {attempt} after {delay}ms"));
            std::thread::sleep(Duration::from_millis(delay));
        }
        match lrclib_search(client, artist, title) {
            Ok(hits) => return Ok(hits),
            Err(e @ (LyricsError::Transient(_) | LyricsError::RateLimit(_))) => {
                last_err = Some(e);
            }
            Err(e @ LyricsError::Connectivity(_)) => {
                last_err = Some(e);
            }
            Err(e @ LyricsError::NotFound(_)) | Err(e @ LyricsError::Parse(_)) => return Err(e),
            Err(e) => return Err(e),
        }
    }
    Err(last_err.unwrap_or_else(|| {
        LyricsError::Transient(
            "LRCLIB SEARCH failed after retries (service may be unavailable)".into(),
        )
    }))
}

fn read_cached_lyrics(cache_dir: &Path, key: &str) -> Option<LyricsResult> {
    let cache = read_cache(cache_dir, key)?;
    if cache.not_found {
        return None;
    }
    cache.result
}

fn try_lrclib_get_only(
    client: &reqwest::blocking::Client,
    artist: &str,
    title: &str,
    duration_ms: Option<u64>,
    get_attempt_budget: u32,
) -> Result<(String, bool, String, String), LyricsError> {
    let duration_attempts: Vec<Option<u64>> = if duration_ms.is_some() {
        vec![duration_ms, None]
    } else {
        vec![None]
    };

    let mut last_miss: Option<LyricsError> = None;
    let mut last_retryable: Option<LyricsError> = None;

    for dur in duration_attempts {
        let body = match lrclib_get_with_retry(client, artist, title, dur, get_attempt_budget) {
            Ok(b) => b,
            Err(e @ (LyricsError::Transient(_) | LyricsError::RateLimit(_) | LyricsError::Connectivity(_))) => {
                last_retryable = Some(e);
                continue;
            }
            Err(LyricsError::NotFound(e)) => {
                last_miss = Some(LyricsError::NotFound(e));
                continue;
            }
            Err(e) => return Err(e),
        };
        let found_artist = body.artist_name.as_deref().unwrap_or(artist);
        let found_title = body.track_name.as_deref().unwrap_or(title);
        if validate_lrclib_match(artist, title, found_artist, found_title) {
            if let Some(lrc) = lrc_from_lrclib(&body) {
                lyrics_log(format!(
                    "LRCLIB GET match ok synced={} found={found_artist} - {found_title} duration_ms={dur:?}",
                    lrc.1
                ));
                return Ok((
                    lrc.0,
                    lrc.1,
                    found_artist.to_string(),
                    found_title.to_string(),
                ));
            }
            lyrics_log(
                "LRCLIB GET match validated but no synced/plain lyric text in response",
            );
        } else {
            lyrics_log(format!(
                "LRCLIB GET rejected match query={artist}/{title} found={found_artist}/{found_title}"
            ));
        }
        last_miss = Some(LyricsError::NotFound(
            "LRCLIB GET had no validated match".into(),
        ));
    }

    if let Some(e) = last_retryable {
        return Err(e);
    }
    Err(last_miss.unwrap_or_else(|| {
        LyricsError::NotFound("LRCLIB GET had no validated match".into())
    }))
}

fn try_lrclib_search_only(
    client: &reqwest::blocking::Client,
    artist: &str,
    title: &str,
    duration_ms: Option<u64>,
    search_attempt_budget: u32,
) -> Result<(String, bool, String, String, u32), LyricsError> {
    let hits = lrclib_search_with_retry(client, artist, title, search_attempt_budget)?;
    let hit_count = hits.len() as u32;
    let mut best: Option<(f32, &LrcLibSearchHit)> = None;
    let mut rejected = 0usize;
    for hit in &hits {
        let fa = hit.artist_name.as_deref().unwrap_or("");
        let ft = hit.track_name.as_deref().unwrap_or("");
        if !validate_lrclib_match(artist, title, fa, ft) {
            rejected += 1;
            continue;
        }
        if !duration_compatible(duration_ms, hit.duration) {
            rejected += 1;
            continue;
        }
        let score = similarity(title, ft) * 0.7 + similarity(artist, fa) * 0.3;
        if best.as_ref().map(|(s, _)| score > *s).unwrap_or(true) {
            best = Some((score, hit));
        }
    }
    if rejected > 0 {
        lyrics_log(format!("LRCLIB SEARCH rejected {rejected} hit(s) by validation"));
    }

    if let Some((score, hit)) = best {
        if let Some(lrc) = lrc_from_search_hit(hit) {
            lyrics_log(format!(
                "LRCLIB SEARCH match score={score:.2} synced={}",
                lrc.1
            ));
            return Ok((
                lrc.0,
                lrc.1,
                hit.artist_name.clone().unwrap_or_default(),
                hit.track_name.clone().unwrap_or_default(),
                hit_count,
            ));
        }
        lyrics_log("LRCLIB SEARCH best hit had no lyric text");
    } else if !hits.is_empty() {
        lyrics_log("LRCLIB SEARCH no hits passed validation");
    }

    Err(LyricsError::NotFound(
        "no LRCLIB result with matching metadata and lyric text".into(),
    ))
}

fn try_lrclib_lookup(
    client: &reqwest::blocking::Client,
    artist: &str,
    title: &str,
    duration_ms: Option<u64>,
) -> Result<(String, bool, String, String), LyricsError> {
    match try_lrclib_get_only(client, artist, title, duration_ms, 2) {
        Ok(v) => return Ok(v),
        Err(LyricsError::NotFound(_)) => {}
        Err(e @ (LyricsError::Transient(_) | LyricsError::RateLimit(_) | LyricsError::Connectivity(_))) => {
            // Still attempt SEARCH — GET may fail while search works.
            lyrics_log(format!("LRCLIB GET failed before SEARCH ({e}); trying SEARCH"));
        }
        Err(e) => return Err(e),
    }
    match try_lrclib_search_only(client, artist, title, duration_ms, 2) {
        Ok((lrc, synced, fa, ft, _)) => Ok((lrc, synced, fa, ft)),
        Err(e) => Err(e),
    }
}

pub fn fetch_lyrics_for_track(
    cache_dir: &Path,
    artist: &str,
    title: &str,
    duration_ms: Option<u64>,
    bypass_negative_cache: bool,
    request_id: u64,
) -> Result<LyricsResult, LyricsError> {
    let client = http_client()?;
    fetch_lyrics_for_track_with_client(
        cache_dir,
        artist,
        title,
        duration_ms,
        bypass_negative_cache,
        request_id,
        &client,
    )
}

pub fn fetch_lyrics_for_track_with_client(
    cache_dir: &Path,
    artist: &str,
    title: &str,
    duration_ms: Option<u64>,
    bypass_negative_cache: bool,
    request_id: u64,
    client: &reqwest::blocking::Client,
) -> Result<LyricsResult, LyricsError> {
    register_fetch_request(request_id);
    let deadline = Instant::now() + Duration::from_secs(FETCH_DEADLINE_SECS);
    ensure_fetch_active(request_id)?;
    fs::create_dir_all(cache_dir)?;
    let raw_artist = artist.trim();
    let raw_title = title.trim();
    let (artist, title) = resolve_lrclib_metadata(raw_artist, raw_title);
    let key = track_key(&artist, &title, duration_ms);

    let mut diag = LyricsFetchDiagnostics {
        track_key: key.clone(),
        normalized_artist: artist.clone(),
        normalized_title: title.clone(),
        language_hint: language_hint(&title, &artist),
        transliteration_sample: romanize_display_text(&title),
        ..LyricsFetchDiagnostics::default()
    };

    lyrics_log(format!(
        "fetch artist={artist:?} title={title:?} key={key} duration_ms={duration_ms:?} request_id={request_id}"
    ));

    if let Some(cache) = read_cache(cache_dir, &key) {
        if cache.not_found {
            let age = now_ms().saturating_sub(cache.cached_at_ms);
            if !bypass_negative_cache && age < NEGATIVE_CACHE_TTL_MS {
                lyrics_log(format!(
                    "negative cache hit (age_ms={age}, ttl_ms={NEGATIVE_CACHE_TTL_MS})"
                ));
                diag.cache_hit = "negative".into();
                diag.last_error_class = "not_found_cached".into();
                set_lyrics_diag(diag);
                return Err(LyricsError::NotFound(
                    "LRCLIB has no matching lyrics for this track (cached miss)".into(),
                ));
            }
            lyrics_log("negative cache expired, retrying LRCLIB");
        } else if let Some(result) = cache.result {
            lyrics_log(format!(
                "disk cache hit source={} lines={}",
                result.source,
                result.lines.len()
            ));
            diag.cache_hit = "positive".into();
            set_lyrics_diag(diag);
            return Ok(result);
        }
    }

    diag.cache_hit = "miss".into();
    let stale_on_fail = read_cached_lyrics(cache_dir, &key);
    let variants = lookup_variants(raw_artist, raw_title);
    diag.variant_count = variants.len() as u32;
    lyrics_log(format!("trying {} lookup variant(s)", variants.len()));
    let mut last_retryable_err: Option<LyricsError> = None;
    let mut should_try_search = false;
    let mut rate_limited = false;
    let mut search_ran = false;

    let mut cache_success = |diag: &mut LyricsFetchDiagnostics, result: LyricsResult| {
        write_cache(
            cache_dir,
            &key,
            &LyricsCacheFile {
                schema_version: CACHE_SCHEMA_VERSION,
                track_key: key.clone(),
                not_found: false,
                cached_at_ms: now_ms(),
                result: Some(result.clone()),
            },
        );
        diag.last_error_class = "ok".into();
        set_lyrics_diag(diag.clone());
    };

    const MAX_GET_VARIANTS: usize = 4;
    for (idx, (a, t)) in variants.iter().take(MAX_GET_VARIANTS).enumerate() {
        poll_fetch_lifecycle(request_id, deadline)?;
        if rate_limited {
            break;
        }
        diag.last_stage = "get".into();
        diag.last_variant_artist = a.clone();
        diag.last_variant_title = t.clone();
        let get_budget = if idx == 0 { 2 } else { 1 };
        diag.get_attempts = diag.get_attempts.saturating_add(get_budget);
        lyrics_log(format!("variant GET artist={a:?} title={t:?} budget={get_budget}"));
        match try_lrclib_get_only(client, a, t, duration_ms, get_budget) {
            Ok((lrc, synced, _, _)) => {
                let raw = parse_lrc(&lrc)?;
                let result = build_document(raw, "lrclib", key.clone(), synced)?;
                lyrics_log(format!(
                    "success synced={synced} parsed_lines={}",
                    result.lines.len()
                ));
                cache_success(&mut diag, result.clone());
                return Ok(result);
            }
            Err(LyricsError::RateLimit(e)) => {
                should_try_search = true;
                rate_limited = true;
                diag.last_error_class = "rate_limit".into();
                diag.last_http_status = Some(429);
                last_retryable_err = Some(LyricsError::RateLimit(e));
            }
            Err(LyricsError::Transient(e)) => {
                should_try_search = true;
                diag.last_error_class = "transient".into();
                last_retryable_err = Some(LyricsError::Transient(e));
            }
            Err(LyricsError::Connectivity(e)) => {
                should_try_search = true;
                diag.last_error_class = "connectivity".into();
                last_retryable_err = Some(LyricsError::Connectivity(e));
            }
            Err(LyricsError::NotFound(msg)) => {
                should_try_search = true;
                diag.last_error_class = "not_found".into();
                diag.last_rejection_reason = msg.clone();
                lyrics_log(format!("variant GET miss: {msg}"));
            }
            Err(e) => {
                diag.last_error_class = e.diagnostics_class().into();
                set_lyrics_diag(diag);
                return Err(e);
            }
        }

        if idx == 0 && should_try_search && !rate_limited && !search_ran {
            diag.last_stage = "search_early".into();
            if let Ok((lrc, synced, _, _, hits)) = try_lrclib_search_only(
                client,
                a,
                t,
                duration_ms,
                2,
            ) {
                search_ran = true;
                diag.search_hit_count = hits;
                let raw = parse_lrc(&lrc)?;
                let result = build_document(raw, "lrclib", key.clone(), synced)?;
                diag.last_error_class = "ok_search".into();
                cache_success(&mut diag, result.clone());
                return Ok(result);
            }
            search_ran = true;
        }
    }

    if should_try_search && !rate_limited {
        for (search_a, search_t) in variants.iter().take(4) {
            poll_fetch_lifecycle(request_id, deadline)?;
            diag.last_stage = "search".into();
            lyrics_log(format!(
                "LRCLIB SEARCH artist={search_a:?} title={search_t:?}"
            ));
            match try_lrclib_search_only(client, search_a, search_t, duration_ms, 2) {
                Ok((lrc, synced, _, _, hits)) => {
                    diag.search_hit_count = hits;
                    let raw = parse_lrc(&lrc)?;
                    let result = build_document(raw, "lrclib", key.clone(), synced)?;
                    diag.last_error_class = "ok_search".into();
                    cache_success(&mut diag, result.clone());
                    return Ok(result);
                }
                Err(LyricsError::RateLimit(e)) => {
                    lyrics_log(format!("LRCLIB SEARCH rate limit: {e}"));
                    last_retryable_err = Some(LyricsError::RateLimit(e));
                    diag.last_error_class = "rate_limit".into();
                    break;
                }
                Err(LyricsError::Transient(e)) => {
                    lyrics_log(format!("LRCLIB SEARCH transient: {e}"));
                    last_retryable_err = Some(LyricsError::Transient(e));
                    diag.last_error_class = "transient".into();
                }
                Err(LyricsError::Connectivity(e)) => {
                    lyrics_log(format!("LRCLIB SEARCH connectivity: {e}"));
                    last_retryable_err = Some(LyricsError::Connectivity(e));
                    diag.last_error_class = "connectivity".into();
                }
                Err(LyricsError::NotFound(msg)) => {
                    lyrics_log(format!("LRCLIB SEARCH not found: {msg}"));
                }
                Err(e) => {
                    diag.last_error_class = e.diagnostics_class().into();
                    set_lyrics_diag(diag);
                    return Err(e);
                }
            }
        }
    }

    if let Some(e) = last_retryable_err {
        if let Some(stale) = stale_on_fail {
            lyrics_log("retryable failure — serving last cached lyrics for this track");
            diag.cache_hit = "stale_fallback".into();
            set_lyrics_diag(diag);
            return Ok(stale);
        }
        diag.last_error_class = e.diagnostics_class().into();
        set_lyrics_diag(diag);
        return Err(e);
    }

    if should_try_search && rate_limited {
        if let Some(stale) = stale_on_fail {
            lyrics_log("rate limited — serving last cached lyrics for this track");
            diag.cache_hit = "stale_fallback".into();
            set_lyrics_diag(diag);
            return Ok(stale);
        }
        set_lyrics_diag(diag);
        return Err(LyricsError::RateLimit(
            "LRCLIB rate limit (429); retry later".into(),
        ));
    }

    lyrics_log("all variants exhausted, writing negative cache");
    write_cache(
        cache_dir,
        &key,
        &LyricsCacheFile {
            schema_version: CACHE_SCHEMA_VERSION,
            track_key: key.clone(),
            not_found: true,
            cached_at_ms: now_ms(),
            result: None,
        },
    );
    diag.last_error_class = "not_found".into();
    set_lyrics_diag(diag);
    Err(LyricsError::NotFound(
        "LRCLIB has no matching lyrics for this track".into(),
    ))
}

pub fn load_lrc_from_path(cache_dir: &Path, path: &str) -> Result<LyricsResult, LyricsError> {
    fs::create_dir_all(cache_dir)?;
    let content = fs::read_to_string(path)?;
    let raw = parse_lrc(&content)?;
    let key = track_key("local", path, None);
    let result = build_document(raw, "local", key.clone(), true)?;
    write_cache(
        cache_dir,
        &key,
        &LyricsCacheFile {
            schema_version: CACHE_SCHEMA_VERSION,
            track_key: key.clone(),
            not_found: false,
            cached_at_ms: now_ms(),
            result: Some(result.clone()),
        },
    );
    Ok(result)
}

pub fn active_line_index(lines: &[LyricLine], time_ms: u64) -> Option<usize> {
    if lines.is_empty() {
        return None;
    }
    let mut idx = None;
    for (i, line) in lines.iter().enumerate() {
        if time_ms >= line.start_ms {
            idx = Some(i);
        } else {
            break;
        }
    }
    idx
}

#[cfg(test)]
mod sync_tests {
    use super::*;

    fn sample_lines() -> Vec<LyricLine> {
        enrich_lines(vec![
            (1000, "line one".into()),
            (3000, "line two".into()),
            (6000, "line three".into()),
        ])
    }

    #[test]
    fn active_line_follows_time() {
        let lines = sample_lines();
        assert_eq!(active_line_index(&lines, 999), None);
        assert_eq!(active_line_index(&lines, 1000), Some(0));
        assert_eq!(active_line_index(&lines, 2999), Some(0));
        assert_eq!(active_line_index(&lines, 3000), Some(1));
    }

    #[test]
    fn active_line_respects_offset_via_caller() {
        let lines = sample_lines();
        let offset = 500i64;
        let t = 3000i64 + offset;
        assert_eq!(active_line_index(&lines, t.max(0) as u64), Some(1));
    }

    #[test]
    fn seek_backward_moves_to_earlier_line() {
        let lines = sample_lines();
        assert_eq!(active_line_index(&lines, 5000), Some(1));
        assert_eq!(active_line_index(&lines, 1500), Some(0));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kesariya_pipe_title_normalizes_for_lrclib() {
        let title = "Kesariya - Film Version | Brahmastra | Ranbir | Alia | Pritam | Arijit | Amitabh";
        assert_eq!(clean_video_title(title), "Kesariya");
        let v = lookup_variants("T-Series", title);
        assert!(
            v.iter().any(|(_a, t)| t == "Kesariya"),
            "variants: {:?}",
            v
        );
        assert!(
            v.iter().any(|(a, t)| t == "Kesariya" && a.contains("Arijit")),
            "variants: {:?}",
            v
        );
    }

    #[test]
    fn hindi_fixture_lrc_offline_pipeline() {
        const FIXTURE: &str = include_str!("../tests/fixtures/hindi_sample.lrc");
        let raw = parse_lrc(FIXTURE).unwrap();
        assert_eq!(raw[0].0, 5000);
        assert_eq!(raw[1].0, 12_500);
        let doc = build_document(raw, "fixture", "fixture-key".into(), true).unwrap();
        assert!(!contains_devanagari(&doc.lines[0].text));
        assert!(doc.lines[0].text.to_lowercase().contains("tum"));
        assert_eq!(doc.lines[0].start_ms, 5000);
        assert_eq!(doc.lines[0].words[0].start_ms, 5000);
        assert!(doc.lines[1].text.to_lowercase().contains("kesariya"));
    }

    #[test]
    fn parses_single_timestamp() {
        let raw = parse_lrc("[00:12.34]Hello world\n[01:02.00]Second line").unwrap();
        assert_eq!(raw.len(), 2);
        assert_eq!(raw[0].0, 12_340);
        assert_eq!(raw[0].1, "Hello world");
    }

    #[test]
    fn parses_multiple_timestamps_on_one_line() {
        let raw = parse_lrc("[00:01.00][00:02.00]Same text").unwrap();
        assert_eq!(raw.len(), 2);
        assert_eq!(raw[0].0, 1000);
        assert_eq!(raw[1].0, 2000);
        assert_eq!(raw[0].1, "Same text");
    }

    #[test]
    fn skips_metadata_tags() {
        let raw = parse_lrc("[ar:Artist]\n[ti:Title]\n[00:10.00]Sing").unwrap();
        assert_eq!(raw.len(), 1);
        assert_eq!(raw[0].1, "Sing");
    }

    #[test]
    fn ignores_malformed_lines() {
        let raw = parse_lrc("not a line\n[xx:yy]bad\n[00:01.00]OK").unwrap();
        assert_eq!(raw.len(), 1);
        assert_eq!(raw[0].1, "OK");
    }

    #[test]
    fn normalizes_youtube_channel_as_untrusted_artist() {
        assert!(is_untrusted_media_artist("ShawnMendesVEVO"));
        let (a, t) = normalize_lrclib_query(
            "ShawnMendesVEVO",
            "Shawn Mendes, Camila Cabello - Señorita",
        );
        assert_eq!(a, "Shawn Mendes");
        assert_eq!(t, "Señorita");
    }

    #[test]
    fn cleans_youtube_suffixes() {
        let t = clean_video_title("We Don't Talk Anymore (Official Video)");
        assert!(!t.to_lowercase().contains("official video"));
        assert!(t.contains("We Don't Talk Anymore"));
    }

    #[test]
    fn normalizes_featuring_in_match() {
        let a = normalize_for_match("We Don't Talk Anymore (feat. Selena Gomez)");
        let b = normalize_for_match("We Don't Talk Anymore");
        assert!(similarity(&a, &b) > 0.8);
    }

    #[test]
    fn validates_lrclib_match() {
        assert!(validate_lrclib_match(
            "Charlie Puth",
            "We Don't Talk Anymore",
            "Charlie Puth",
            "We Don't Talk Anymore (feat. Selena Gomez)"
        ));
    }

    #[test]
    fn enriches_word_timings_as_estimated() {
        let lines = enrich_lines(vec![(1000, "hello world".into()), (3000, "next".into())]);
        assert_eq!(lines[0].words.len(), 2);
        assert!(lines[0].words[0].estimated);
        assert_eq!(lines[0].end_ms, 3000);
    }

    #[test]
    fn hindi_title_adds_romanized_lookup_variant() {
        let v = lookup_variants("Arijit Singh", "तुम ही हो");
        assert!(
            v.iter()
                .any(|(_, t)| t.to_lowercase().contains("tum") || t.contains("Tum")),
            "expected romanized title variant, got {:?}",
            v
        );
    }

    #[test]
    fn normalize_match_romanizes_devanagari() {
        let a = normalize_for_match("तुम ही हो");
        let b = normalize_for_match("tum hi ho");
        assert!(similarity(&a, &b) > 0.7);
    }

    #[test]
    fn build_document_romanizes_devanagari_lines() {
        let doc = build_document(
            vec![(1000, "तुम ही हो".into())],
            "test",
            "k".into(),
            true,
        )
        .unwrap();
        assert!(!contains_devanagari(&doc.lines[0].text));
        assert!(doc.lines[0].text.to_lowercase().contains("tum"));
    }

    #[test]
    fn lookup_variants_include_base_and_no_feat() {
        let v = lookup_variants(
            "Charlie Puth",
            "We Don't Talk Anymore (feat. Selena Gomez) [Official Video]",
        );
        assert!(!v.is_empty());
        assert!(
            v.iter()
                .any(|(_, t)| t.to_lowercase().contains("we don't talk anymore")),
        );
    }

    #[test]
    fn katy_perry_official_youtube_title_normalizes() {
        let cleaned = clean_video_title("Katy Perry - Harleys In Hawaii (Official)");
        assert!(cleaned.to_lowercase().contains("harleys"));
        assert!(!cleaned.to_lowercase().contains("official"));
        let (artist, title) = resolve_lrclib_metadata(
            "Katy Perry",
            "Katy Perry - Harleys In Hawaii (Official)",
        );
        assert_eq!(artist, "Katy Perry");
        assert!(title.to_lowercase().contains("harleys"));
    }

    #[test]
    fn reversed_youtube_title_uses_smtc_artist() {
        let (artist, title) =
            resolve_lrclib_metadata("Katy Perry", "Harleys In Hawaii - Katy Perry");
        assert_eq!(artist, "Katy Perry");
        assert!(title.to_lowercase().contains("harleys"));
    }

    #[test]
    fn harleys_title_adds_apostrophe_variant() {
        let v = apostrophe_title_variants("Harleys in Hawaii");
        assert!(
            v.iter().any(|t| t.contains("Harley's")),
            "variants: {:?}",
            v
        );
        let lookups = lookup_variants("Katy Perry", "Harleys in Hawaii");
        assert!(
            lookups.iter().any(|(_, t)| t.contains("Harley's")),
            "lookup variants: {:?}",
            lookups
        );
    }

    #[test]
    fn harley_apostrophe_title_validates_for_search() {
        let a = normalize_for_match("Harleys in Hawaii");
        let b = normalize_for_match("Harley's in Hawaii");
        assert_eq!(a, b, "normalized titles should match possessive spelling");
        assert!(validate_lrclib_match(
            "Katy Perry",
            "Harleys in Hawaii",
            "Katy Perry",
            "Harley\u{2019}s in Hawaii",
        ));
    }

    #[test]
    fn cross_track_request_supersession() {
        register_fetch_request(10);
        assert!(fetch_request_active(10));
        assert!(!fetch_request_active(9));
        register_fetch_request(11);
        assert!(!fetch_request_active(10));
        assert!(fetch_request_active(11));
    }

    #[test]
    fn get_400_is_not_found_not_network() {
        assert!(!is_transient_http(400));
    }

    #[test]
    fn transient_http_codes() {
        assert!(is_transient_http(503));
        assert!(is_transient_http(429));
        assert!(!is_transient_http(404));
    }

    #[test]
    fn deserializes_lrclib_camel_case_get_response() {
        let json = r#"{"trackName":"We Don't Talk Anymore","artistName":"Charlie Puth","syncedLyrics":"[00:01.00] Hello","plainLyrics":"Hello"}"#;
        let body: LrcLibGetResponse = serde_json::from_str(json).unwrap();
        assert_eq!(body.track_name.as_deref(), Some("We Don't Talk Anymore"));
        assert!(body.synced_lyrics.as_ref().is_some_and(|s| s.contains("Hello")));
        assert!(lrc_from_lrclib(&body).is_some());
    }

    #[test]
    #[ignore = "live network — run with cargo test live_lrclib_probe -- --ignored --nocapture"]
    fn live_lrclib_probe() {
        let probe = probe_lrclib_connectivity();
        eprintln!("{probe:?}");
        assert_eq!(probe.api_root, "https://lrclib.net");
    }

    #[test]
    #[ignore = "requires network"]
    fn live_lrclib_charlie_puth_we_dont_talk() {
        let client = http_client().expect("http client");
        let (lrc, synced, fa, ft) = try_lrclib_lookup(
            &client,
            "Charlie Puth",
            "We Don't Talk Anymore",
            None,
        )
        .expect("live LRCLIB lookup");
        assert!(synced, "expected synced lyrics");
        assert!(lrc.contains('['), "expected LRC timestamps");
        assert!(fa.to_lowercase().contains("charlie"));
        assert!(ft.to_lowercase().contains("talk"));
        let raw = parse_lrc(&lrc).expect("parse");
        assert!(!raw.is_empty());
    }
}

#[cfg(test)]
mod fetch_http_tests {
    use super::*;
    use mockito::{Matcher, Server};

    fn reset_lyrics_test_state() {
        set_test_lrclib_base(None);
        ACTIVE_FETCH_REQUEST.store(0, Ordering::SeqCst);
        if let Ok(mut g) = LAST_LYRICS_DIAG.lock() {
            *g = None;
        }
    }

    fn with_mock_server<F: FnOnce(&mut Server)>(run: F) {
        reset_lyrics_test_state();
        let mut server = Server::new();
        set_test_lrclib_base(Some(server.url()));
        run(&mut server);
        set_test_lrclib_base(None);
        drop(server);
        reset_lyrics_test_state();
    }

    #[test]
    fn get_404_then_search_success_mock() {
        with_mock_server(|server| {
            let _get = server
                .mock("GET", Matcher::Regex(r".*/api/get.*".to_string()))
                .with_status(404)
                .create();
            let search_body = r#"[{"trackName":"Harley's in Hawaii","artistName":"Katy Perry","syncedLyrics":"[00:12.00]Test line","duration":190.0}]"#;
            let _search = server
                .mock("GET", Matcher::Regex(r".*/api/search.*".to_string()))
                .with_status(200)
                .with_header("content-type", "application/json")
                .with_body(search_body)
                .create();
            let dir = tempfile::tempdir().expect("tempdir");
            let client = http_client().expect("client");
            let result = fetch_lyrics_for_track_with_client(
                dir.path(),
                "Katy Perry",
                "Harleys in Hawaii",
                Some(203_000),
                true,
                0,
                &client,
            )
            .expect("search fallback should succeed");
            assert!(!result.lines.is_empty());
            assert!(result.synced);
        });
    }

    #[test]
    fn get_502_then_search_success_mock() {
        with_mock_server(|server| {
            let _get = server
                .mock("GET", Matcher::Regex(r".*/api/get.*".to_string()))
                .with_status(502)
                .create();
            let search_body = r#"[{"trackName":"Harley's in Hawaii","artistName":"Katy Perry","syncedLyrics":"[00:12.00]Line","duration":190.0}]"#;
            let _search = server
                .mock("GET", Matcher::Regex(r".*/api/search.*".to_string()))
                .with_status(200)
                .with_header("content-type", "application/json")
                .with_body(search_body)
                .create();
            let dir = tempfile::tempdir().expect("tempdir");
            let client = http_client().expect("client");
            let result = fetch_lyrics_for_track_with_client(
                dir.path(),
                "Katy Perry",
                "Harleys In Hawaii (Official)",
                Some(204_000),
                true,
                0,
                &client,
            )
            .expect("early search after transient GET should succeed");
            assert!(!result.lines.is_empty());
        });
    }

    #[test]
    fn search_rejects_wrong_song_mock() {
        with_mock_server(|server| {
            let _get = server
                .mock("GET", Matcher::Regex(r".*/api/get.*".to_string()))
                .with_status(404)
                .create();
            let search_body = r#"[{"trackName":"Different Song","artistName":"Other Artist","syncedLyrics":"[00:01.00]Nope","duration":200.0}]"#;
            let _search = server
                .mock("GET", Matcher::Regex(r".*/api/search.*".to_string()))
                .with_status(200)
                .with_header("content-type", "application/json")
                .with_body(search_body)
                .create();
            let dir = tempfile::tempdir().expect("tempdir");
            let client = http_client().expect("client");
            let err = fetch_lyrics_for_track_with_client(
                dir.path(),
                "Katy Perry",
                "Harleys in Hawaii",
                None,
                true,
                0,
                &client,
            )
            .expect_err("wrong song must not be accepted");
            assert!(matches!(err, LyricsError::NotFound(_)));
        });
    }

    #[test]
    fn malformed_search_json_is_parse_error() {
        with_mock_server(|server| {
            let _get = server
                .mock("GET", Matcher::Regex(r".*/api/get.*".to_string()))
                .with_status(404)
                .expect_at_least(1)
                .create();
            let _search = server
                .mock("GET", Matcher::Regex(r".*/api/search.*".to_string()))
                .with_status(200)
                .with_header("content-type", "application/json")
                .with_body("{not-json")
                .expect_at_least(1)
                .create();
            let dir = tempfile::tempdir().expect("tempdir");
            let client = http_client().expect("client");
            let err = fetch_lyrics_for_track_with_client(
                dir.path(),
                "Katy Perry",
                "Unique Title For Parse Test",
                None,
                true,
                0,
                &client,
            )
            .expect_err("malformed JSON should fail parse");
            assert!(matches!(err, LyricsError::Parse(_)));
        });
    }

    #[test]
    fn cross_track_abcd_recovery_mock() {
        with_mock_server(|server| {
            let _get = server
                .mock("GET", Matcher::Regex(r".*/api/get.*".to_string()))
                .with_status(503)
                .create();
            let _search = server
                .mock("GET", Matcher::Regex(r".*/api/search.*".to_string()))
                .with_status(503)
                .create();
            let dir = tempfile::tempdir().expect("tempdir");
            let client = http_client().expect("client");
            let err = fetch_lyrics_for_track_with_client(
                dir.path(),
                "Fifth Harmony",
                "Worth It",
                Some(401_000),
                true,
                0,
                &client,
            )
            .expect_err("track A should fail on LRCLIB 503");
            assert!(
                matches!(err, LyricsError::Transient(_)),
                "track A error was: {err:?}"
            );
        });

        with_mock_server(|server| {
            let _get = server
                .mock("GET", Matcher::Regex(r".*/api/get.*".to_string()))
                .with_status(404)
                .create();
            let body = r#"[{"trackName":"Love Story","artistName":"Taylor Swift","syncedLyrics":"[00:05.00]Line","duration":402.0}]"#;
            let _search = server
                .mock("GET", Matcher::Regex(r".*/api/search.*".to_string()))
                .with_status(200)
                .with_header("content-type", "application/json")
                .with_body(body)
                .create();
            let dir = tempfile::tempdir().expect("tempdir");
            let client = http_client().expect("client");
            let ok = fetch_lyrics_for_track_with_client(
                dir.path(),
                "Taylor Swift",
                "Love Story",
                Some(402_000),
                true,
                0,
                &client,
            )
            .expect("track B must succeed after track A outage");
            assert!(!ok.lines.is_empty());
        });
    }
}
