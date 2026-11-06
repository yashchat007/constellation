#[derive(Debug, Clone)]
pub struct TrackQuery {
    pub raw_artist: String,
    pub raw_title: String,
    pub normalized_artist: String,
    pub normalized_title: String,
    pub canonical_title: String,
    pub album: String,
    pub duration_ms: Option<u64>,
    pub track_key: String,
}

impl TrackQuery {
    pub fn title_candidates(&self) -> Vec<&str> {
        let mut out = vec![self.canonical_title.as_str(), self.normalized_title.as_str()];
        out.sort();
        out.dedup();
        out.retain(|s| !s.trim().is_empty());
        if out.is_empty() {
            out.push(self.normalized_title.as_str());
        }
        out
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TimingQuality {
    Word,
    Line,
    Estimated,
    None,
}

impl TimingQuality {
    pub fn as_str(self) -> &'static str {
        match self {
            TimingQuality::Word => "word",
            TimingQuality::Line => "line",
            TimingQuality::Estimated => "estimated",
            TimingQuality::None => "none",
        }
    }
}

#[derive(Debug, Clone)]
pub struct ProviderSuccess {
    pub result: crate::lyrics::LyricsResult,
    pub provider: &'static str,
    pub format: &'static str,
    pub timing: TimingQuality,
    pub http_status: u16,
    pub duration_ms: u64,
}
