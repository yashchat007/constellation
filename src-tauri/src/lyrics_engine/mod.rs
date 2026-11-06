mod better_lyrics;
mod circuit;
mod karalyr;
mod lrcmux;
mod orchestrator;
mod ttml;
mod types;

pub use orchestrator::fetch_alternate_providers;
pub use types::TrackQuery;

#[cfg(test)]
mod tests;
