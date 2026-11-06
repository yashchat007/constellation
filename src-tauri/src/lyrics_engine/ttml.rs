use crate::lyrics::{LyricLine, LyricWord, LyricsError};
use regex::Regex;

fn parse_ttml_time(raw: &str) -> Result<u64, LyricsError> {
    let s = raw.trim();
    if s.ends_with('s') && !s.contains(':') {
        let secs: f64 = s.trim_end_matches('s').parse().map_err(|e| {
            LyricsError::Parse(format!("ttml time: {e}"))
        })?;
        return Ok((secs * 1000.0).round() as u64);
    }
    let parts: Vec<&str> = s.split(':').collect();
    if parts.len() == 3 {
        let h: u64 = parts[0].parse().unwrap_or(0);
        let m: u64 = parts[1].parse().unwrap_or(0);
        let sec: f64 = parts[2].parse().unwrap_or(0.0);
        return Ok(h * 3_600_000 + m * 60_000 + (sec * 1000.0).round() as u64);
    }
    if parts.len() == 2 {
        let m: u64 = parts[0].parse().unwrap_or(0);
        let sec: f64 = parts[1].parse().unwrap_or(0.0);
        return Ok(m * 60_000 + (sec * 1000.0).round() as u64);
    }
    Err(LyricsError::Parse(format!("unrecognized ttml time {s}")))
}

/// Parse Better Lyrics TTML into timed lines with word-level timing from syllable spans.
pub fn ttml_to_lines(ttml: &str) -> Result<Vec<LyricLine>, LyricsError> {
    let span_re = Regex::new(
        r#"(?is)<span[^>]*\bbegin="([^"]+)"[^>]*\bend="([^"]+)"[^>]*>(.*?)</span>"#,
    )
    .map_err(|e| LyricsError::Parse(e.to_string()))?;

    let mut lines: Vec<LyricLine> = Vec::new();
    let p_re = Regex::new(r"(?is)<p[^>]*>(.*?)</p>").map_err(|e| LyricsError::Parse(e.to_string()))?;

    let strip_tags = |s: &str| -> String {
        Regex::new(r"(?is)<[^>]+>")
            .unwrap()
            .replace_all(s, "")
            .to_string()
            .replace("&amp;", "&")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace('\n', " ")
    };

    let parse_spans_in_chunk = |chunk: &str| -> Result<Option<LyricLine>, LyricsError> {
        let mut words: Vec<LyricWord> = Vec::new();
        for cap in span_re.captures_iter(chunk) {
            let begin = parse_ttml_time(&cap[1])?;
            let end = parse_ttml_time(&cap[2])?;
            let text = strip_tags(&cap[3]).trim().to_string();
            if text.is_empty() {
                continue;
            }
            words.push(LyricWord {
                start_ms: begin,
                end_ms: end.max(begin + 1),
                text,
                estimated: false,
            });
        }
        if words.is_empty() {
            return Ok(None);
        }
        let start_ms = words.first().map(|w| w.start_ms).unwrap_or(0);
        let end_ms = words.last().map(|w| w.end_ms).unwrap_or(start_ms + 1000);
        let text = words
            .iter()
            .map(|w| w.text.as_str())
            .collect::<Vec<_>>()
            .join("");
        Ok(Some(LyricLine {
            start_ms,
            end_ms,
            text,
            words,
        }))
    };

    if p_re.is_match(ttml) {
        for cap in p_re.captures_iter(ttml) {
            if let Some(line) = parse_spans_in_chunk(&cap[1])? {
                lines.push(line);
            }
        }
    } else if let Some(line) = parse_spans_in_chunk(ttml)? {
        lines.push(line);
    }

    if lines.is_empty() {
        return Err(LyricsError::Parse("no timed spans in TTML".into()));
    }
    Ok(lines)
}
