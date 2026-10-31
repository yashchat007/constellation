use crate::audio::diag::{sample_rate, should_log_interval};
use crate::audio::features::{
    band_energy, hann_window, normalize_centroid, normalize_energy, onset_strength, rms_energy,
    signal_present, spectral_centroid, ExponentialSmoother,
};
use crate::audio::types::AudioFeatureSnapshot;
use realfft::num_complex::Complex;
use realfft::RealFftPlanner;
use std::collections::VecDeque;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const FFT_SIZE: usize = 2048;
const EMIT_INTERVAL: Duration = Duration::from_millis(50);

pub struct AudioAnalyzer {
    sample_buffer: VecDeque<f32>,
    window: Vec<f32>,
    fft_in: Vec<f32>,
    fft_out: Vec<Complex<f32>>,
    magnitudes: Vec<f32>,
    fft: std::sync::Arc<dyn realfft::RealToComplex<f32>>,
    energy_smooth: ExponentialSmoother,
    bass_smooth: ExponentialSmoother,
    mid_smooth: ExponentialSmoother,
    treble_smooth: ExponentialSmoother,
    centroid_smooth: ExponentialSmoother,
    onset_smooth: ExponentialSmoother,
    prev_band_energy: f32,
    last_emit: Instant,
    sensitivity: f32,
    smoothing: f32,
}

impl AudioAnalyzer {
    pub fn new(sensitivity: f32, smoothing: f32) -> Self {
        let mut planner = RealFftPlanner::<f32>::new();
        let fft = planner.plan_fft_forward(FFT_SIZE);
        let s = smoothing.clamp(0.05, 0.95);
        Self {
            sample_buffer: VecDeque::with_capacity(FFT_SIZE * 2),
            window: hann_window(FFT_SIZE),
            fft_in: vec![0.0; FFT_SIZE],
            fft_out: vec![Complex::new(0.0, 0.0); FFT_SIZE / 2 + 1],
            magnitudes: vec![0.0; FFT_SIZE / 2 + 1],
            fft,
            energy_smooth: ExponentialSmoother::new(0.0, s, s * 0.5),
            bass_smooth: ExponentialSmoother::new(0.0, s, s * 0.5),
            mid_smooth: ExponentialSmoother::new(0.0, s, s * 0.5),
            treble_smooth: ExponentialSmoother::new(0.0, s, s * 0.5),
            centroid_smooth: ExponentialSmoother::new(0.0, s * 0.8, s * 0.4),
            onset_smooth: ExponentialSmoother::new(0.0, 0.35, 0.12),
            prev_band_energy: 0.0,
            last_emit: Instant::now() - EMIT_INTERVAL,
            sensitivity: sensitivity.clamp(0.3, 3.0),
            smoothing: s,
        }
    }

    pub fn set_tuning(&mut self, sensitivity: f32, smoothing: f32) {
        self.sensitivity = sensitivity.clamp(0.3, 3.0);
        self.smoothing = smoothing.clamp(0.05, 0.95);
        self.energy_smooth.attack = self.smoothing;
        self.energy_smooth.release = self.smoothing * 0.5;
    }

    pub fn push_samples(&mut self, samples: &[f32]) {
        for &s in samples {
            if self.sample_buffer.len() >= FFT_SIZE * 4 {
                self.sample_buffer.pop_front();
            }
            self.sample_buffer.push_back(s);
        }
    }

    pub fn maybe_analyze(&mut self, is_capturing: bool) -> Option<AudioFeatureSnapshot> {
        if self.last_emit.elapsed() < EMIT_INTERVAL {
            return None;
        }
        self.last_emit = Instant::now();

        if self.sample_buffer.len() < FFT_SIZE {
            return Some(silent_snapshot(is_capturing));
        }

        let sr = sample_rate().max(8000) as f32;

        let start = self.sample_buffer.len() - FFT_SIZE;
        for i in 0..FFT_SIZE {
            self.fft_in[i] = self.sample_buffer[start + i] * self.window[i];
        }
        self.fft
            .process(&mut self.fft_in, &mut self.fft_out)
            .expect("fft process");

        for (i, c) in self.fft_out.iter().enumerate() {
            self.magnitudes[i] = c.norm();
        }

        let frame_rms = rms_energy(&self.fft_in);
        let norm = normalize_energy(frame_rms, 0.002, 0.35);
        self.energy_smooth.step(norm);

        let bass = band_energy(&self.magnitudes, sr, FFT_SIZE, 40.0, 250.0);
        let low_mid = band_energy(&self.magnitudes, sr, FFT_SIZE, 250.0, 500.0);
        let mid = band_energy(&self.magnitudes, sr, FFT_SIZE, 500.0, 2000.0);
        let high_mid = band_energy(&self.magnitudes, sr, FFT_SIZE, 2000.0, 6000.0);
        let treble = band_energy(&self.magnitudes, sr, FFT_SIZE, 6000.0, 12_000.0);

        self.bass_smooth.step((bass * 4.0 * self.sensitivity).clamp(0.0, 1.0));
        self.mid_smooth.step(((mid + low_mid) * 3.5 * self.sensitivity).clamp(0.0, 1.0));
        self.treble_smooth.step((treble * 5.0 * self.sensitivity).clamp(0.0, 1.0));

        let centroid = spectral_centroid(&self.magnitudes, sr, FFT_SIZE);
        self.centroid_smooth
            .step(normalize_centroid(centroid, sr));

        let band_total = self.bass_smooth.value + self.mid_smooth.value + self.treble_smooth.value;
        let raw_onset = onset_strength(band_total, self.prev_band_energy, self.sensitivity);
        self.prev_band_energy = band_total * 0.9 + self.prev_band_energy * 0.1;
        self.onset_smooth.step(raw_onset);

        let present = signal_present(frame_rms, 0.003);

        if should_log_interval(1.0) {
            let (chunks, samples) = crate::audio::diag::capture_stats();
            if cfg!(debug_assertions) || std::env::var_os("CONSTELLATION_LOG").is_some() {
                eprintln!(
                    "[constellation:audio:diag] capturing={} signal={} sample_rate={} buffer_fft={} chunks={} samples_in={} rms={:.5} bass={:.3} mid={:.3} treble={:.3} onset={:.3} ts={}",
                    is_capturing,
                    present,
                    sample_rate(),
                    self.sample_buffer.len(),
                    chunks,
                    samples,
                    frame_rms,
                    self.bass_smooth.value,
                    self.mid_smooth.value,
                    self.treble_smooth.value,
                    self.onset_smooth.value,
                    now_ms()
                );
            }
        }

        Some(AudioFeatureSnapshot {
            capture_available: cfg!(windows),
            is_capturing,
            is_signal_present: present,
            sample_rate: sample_rate(),
            rms_energy: frame_rms,
            normalized_energy: self.energy_smooth.value,
            bass_energy: self.bass_smooth.value,
            low_mid_energy: (low_mid * 3.0).clamp(0.0, 1.0),
            mid_energy: self.mid_smooth.value,
            high_mid_energy: (high_mid * 3.0).clamp(0.0, 1.0),
            treble_energy: self.treble_smooth.value,
            spectral_centroid: self.centroid_smooth.value,
            onset_strength: self.onset_smooth.value,
            estimated_bpm: None,
            timestamp_ms: now_ms(),
        })
    }
}

fn silent_snapshot(is_capturing: bool) -> AudioFeatureSnapshot {
    AudioFeatureSnapshot {
        capture_available: cfg!(windows),
        is_capturing,
        is_signal_present: false,
        sample_rate: sample_rate(),
        ..AudioFeatureSnapshot::default()
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn analyzer_emits_after_fill() {
        let mut a = AudioAnalyzer::new(1.0, 0.2);
        let samples: Vec<f32> = (0..FFT_SIZE)
            .map(|i| (i as f32 * 0.05).sin() * 0.3)
            .collect();
        a.push_samples(&samples);
        let snap = a.maybe_analyze(true);
        assert!(snap.is_some());
        let s = snap.unwrap();
        assert!(s.is_capturing);
    }
}
