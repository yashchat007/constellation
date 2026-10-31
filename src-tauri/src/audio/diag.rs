use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Instant;

static SAMPLE_RATE: AtomicU32 = AtomicU32::new(48_000);
static CHUNKS: AtomicU64 = AtomicU64::new(0);
static SAMPLES: AtomicU64 = AtomicU64::new(0);
static LAST_LOG: Mutex<Option<Instant>> = Mutex::new(None);

pub fn set_sample_rate(rate: u32) {
    SAMPLE_RATE.store(rate.max(8000), Ordering::Relaxed);
}

pub fn sample_rate() -> u32 {
    SAMPLE_RATE.load(Ordering::Relaxed)
}

pub fn on_chunk(samples: &[f32]) {
    CHUNKS.fetch_add(1, Ordering::Relaxed);
    SAMPLES.fetch_add(samples.len() as u64, Ordering::Relaxed);
}

pub fn capture_stats() -> (u64, u64) {
    (
        CHUNKS.load(Ordering::Relaxed),
        SAMPLES.load(Ordering::Relaxed),
    )
}

pub fn reset_capture_stats() {
    CHUNKS.store(0, Ordering::Relaxed);
    SAMPLES.store(0, Ordering::Relaxed);
}

pub fn should_log_interval(secs: f64) -> bool {
    let mut guard = LAST_LOG.lock().unwrap();
    let now = Instant::now();
    if guard
        .map(|t| now.duration_since(t).as_secs_f64() >= secs)
        .unwrap_or(true)
    {
        *guard = Some(now);
        true
    } else {
        false
    }
}
