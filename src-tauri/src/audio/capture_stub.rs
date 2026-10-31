#[cfg(windows)]
pub use super::capture::spawn_capture_worker;

#[cfg(not(windows))]
pub fn spawn_capture_worker(
    _tx: crossbeam_channel::Sender<Vec<f32>>,
    _stop: std::sync::Arc<std::sync::atomic::AtomicBool>,
) -> Result<std::thread::JoinHandle<()>, String> {
    Err("WASAPI loopback capture is only available on Windows".into())
}
