use crossbeam_channel::{bounded, Receiver, Sender, TryRecvError};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread::JoinHandle;
use tauri::{AppHandle, Emitter};

use super::analyzer::AudioAnalyzer;
use super::types::{AudioCaptureStatus, AudioFeatureSnapshot};

#[cfg(windows)]
use super::capture::spawn_capture_worker;
#[cfg(not(windows))]
use super::capture_stub::spawn_capture_worker;

const CHANNEL_CAP: usize = 32;

struct Inner {
    stop: Arc<AtomicBool>,
    capture_handle: Option<JoinHandle<()>>,
    analyze_handle: Option<JoinHandle<()>>,
    sample_tx: Option<Sender<Vec<f32>>>,
    last_error: Option<String>,
    sensitivity: f32,
    smoothing: f32,
    latest: AudioFeatureSnapshot,
}

pub struct AudioService {
    inner: Mutex<Inner>,
}

impl Default for AudioService {
    fn default() -> Self {
        Self {
            inner: Mutex::new(Inner {
                stop: Arc::new(AtomicBool::new(true)),
                capture_handle: None,
                analyze_handle: None,
                sample_tx: None,
                last_error: None,
                sensitivity: 1.0,
                smoothing: 0.22,
                latest: AudioFeatureSnapshot::default(),
            }),
        }
    }
}

static SERVICE: OnceLock<AudioService> = OnceLock::new();

pub fn audio_service() -> &'static AudioService {
    SERVICE.get_or_init(AudioService::default)
}

impl AudioService {
    pub fn status(&self) -> AudioCaptureStatus {
        let inner = self.inner.lock().unwrap();
        let (chunks, samples) = super::diag::capture_stats();
        AudioCaptureStatus {
            capture_available: cfg!(windows),
            is_capturing: !inner.stop.load(Ordering::Relaxed)
                && inner.capture_handle.is_some(),
            last_error: inner.last_error.clone(),
            sample_rate: super::diag::sample_rate(),
            chunks_received: chunks,
            samples_received: samples,
        }
    }

    pub fn latest_snapshot(&self) -> AudioFeatureSnapshot {
        self.inner.lock().unwrap().latest.clone()
    }

    pub fn set_tuning(&self, sensitivity: f32, smoothing: f32) {
        let mut inner = self.inner.lock().unwrap();
        inner.sensitivity = sensitivity.clamp(0.3, 3.0);
        inner.smoothing = smoothing.clamp(0.05, 0.95);
    }

    pub fn tuning(&self) -> (f32, f32) {
        let inner = self.inner.lock().unwrap();
        (inner.sensitivity, inner.smoothing)
    }

    pub fn update_latest(&self, snapshot: AudioFeatureSnapshot) {
        self.inner.lock().unwrap().latest = snapshot;
    }

    pub fn start(&self, app: AppHandle) -> Result<(), String> {
        let mut inner = self.inner.lock().unwrap();
        if !inner.stop.load(Ordering::Relaxed) && inner.capture_handle.is_some() {
            return Ok(());
        }
        inner.stop = Arc::new(AtomicBool::new(false));
        let stop = inner.stop.clone();
        let (tx, rx) = bounded::<Vec<f32>>(CHANNEL_CAP);

        let capture_stop = stop.clone();
        let capture_handle = match spawn_capture_worker(tx, capture_stop) {
            Ok(h) => h,
            Err(e) => {
                inner.last_error = Some(e.clone());
                inner.stop.store(true, Ordering::Relaxed);
                return Err(e);
            }
        };
        inner.capture_handle = Some(capture_handle);

        let analyze_stop = stop.clone();
        let sensitivity = inner.sensitivity;
        let smoothing = inner.smoothing;
        let analyze_handle = std::thread::Builder::new()
            .name("constellation-audio-analyze".into())
            .spawn(move || analyze_loop(app, rx, analyze_stop, sensitivity, smoothing))
            .map_err(|e| e.to_string())?;
        inner.analyze_handle = Some(analyze_handle);
        inner.last_error = None;
        Ok(())
    }

    pub fn stop(&self) {
        let mut inner = self.inner.lock().unwrap();
        inner.stop.store(true, Ordering::Relaxed);
        inner.sample_tx = None;
        if let Some(h) = inner.capture_handle.take() {
            let _ = h.join();
        }
        if let Some(h) = inner.analyze_handle.take() {
            let _ = h.join();
        }
        inner.latest.is_capturing = false;
    }
}

fn analyze_loop(
    app: AppHandle,
    rx: Receiver<Vec<f32>>,
    stop: Arc<AtomicBool>,
    sensitivity: f32,
    smoothing: f32,
) {
    let mut analyzer = AudioAnalyzer::new(sensitivity, smoothing);
    while !stop.load(Ordering::Relaxed) {
        let (sens, smooth) = audio_service().tuning();
        loop {
            match rx.try_recv() {
                Ok(chunk) => analyzer.push_samples(&chunk),
                Err(TryRecvError::Empty) => break,
                Err(TryRecvError::Disconnected) => {
                    if stop.load(Ordering::Relaxed) {
                        return;
                    }
                    break;
                }
            }
        }
        analyzer.set_tuning(sens, smooth);
        if let Some(snapshot) = analyzer.maybe_analyze(true) {
            audio_service().update_latest(snapshot.clone());
            let _ = app.emit("audio-features", snapshot);
        }
        std::thread::sleep(std::time::Duration::from_millis(12));
    }
}
