use std::f32::consts::PI;

/// RMS of mono samples.
pub fn rms_energy(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    let sum: f32 = samples.iter().map(|s| s * s).sum();
    (sum / samples.len() as f32).sqrt()
}

pub fn normalize_energy(rms: f32, noise_floor: f32, ceiling: f32) -> f32 {
    if rms <= noise_floor {
        return 0.0;
    }
    ((rms - noise_floor) / (ceiling - noise_floor)).clamp(0.0, 1.0)
}

pub fn signal_present(rms: f32, threshold: f32) -> bool {
    rms > threshold
}

/// Hann window for FFT input.
pub fn hann_window(size: usize) -> Vec<f32> {
    (0..size)
        .map(|i| {
            let x = i as f32 / size.saturating_sub(1).max(1) as f32;
            0.5 * (1.0 - (2.0 * PI * x).cos())
        })
        .collect()
}

/// Band energy from magnitude spectrum (linear bins).
pub fn band_energy(magnitudes: &[f32], sample_rate: f32, fft_size: usize, low_hz: f32, high_hz: f32) -> f32 {
    if magnitudes.is_empty() || sample_rate <= 0.0 {
        return 0.0;
    }
    let bin_hz = sample_rate / fft_size as f32;
    let lo = ((low_hz / bin_hz).floor() as usize).min(magnitudes.len());
    let hi = ((high_hz / bin_hz).ceil() as usize).min(magnitudes.len());
    if hi <= lo {
        return 0.0;
    }
    let sum: f32 = magnitudes[lo..hi].iter().map(|m| m * m).sum();
    (sum / (hi - lo) as f32).sqrt()
}

pub fn spectral_centroid(magnitudes: &[f32], sample_rate: f32, fft_size: usize) -> f32 {
    if magnitudes.is_empty() {
        return 0.0;
    }
    let bin_hz = sample_rate / fft_size as f32;
    let mut weighted = 0.0f32;
    let mut total = 0.0f32;
    for (i, mag) in magnitudes.iter().enumerate().skip(1) {
        let freq = i as f32 * bin_hz;
        weighted += freq * mag;
        total += mag;
    }
    if total <= 1e-9 {
        return 0.0;
    }
    (weighted / total).clamp(0.0, sample_rate * 0.5)
}

pub fn normalize_centroid(centroid_hz: f32, sample_rate: f32) -> f32 {
    (centroid_hz / (sample_rate * 0.25)).clamp(0.0, 1.0)
}

pub fn onset_strength(current_energy: f32, previous_energy: f32, sensitivity: f32) -> f32 {
    let delta = (current_energy - previous_energy).max(0.0);
    (delta * sensitivity).clamp(0.0, 1.0)
}

pub struct ExponentialSmoother {
    pub value: f32,
    pub attack: f32,
    pub release: f32,
}

impl ExponentialSmoother {
    pub fn new(initial: f32, attack: f32, release: f32) -> Self {
        Self {
            value: initial,
            attack,
            release,
        }
    }

    pub fn step(&mut self, target: f32) {
        let rate = if target > self.value {
            self.attack
        } else {
            self.release
        };
        self.value += (target - self.value) * rate;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rms_of_sine_is_reasonable() {
        let samples: Vec<f32> = (0..512)
            .map(|i| (i as f32 * 0.1).sin() * 0.5)
            .collect();
        let r = rms_energy(&samples);
        assert!(r > 0.2 && r < 0.45);
    }

    #[test]
    fn normalize_respects_noise_floor() {
        assert_eq!(normalize_energy(0.001, 0.01, 0.5), 0.0);
        assert!(normalize_energy(0.3, 0.01, 0.5) > 0.5);
    }

    #[test]
    fn silence_not_present() {
        assert!(!signal_present(0.0005, 0.002));
        assert!(signal_present(0.01, 0.002));
    }

    #[test]
    fn band_energy_empty_is_zero() {
        assert_eq!(band_energy(&[], 48000.0, 2048, 60.0, 250.0), 0.0);
    }

    #[test]
    fn smoother_does_not_jump_instantly() {
        let mut s = ExponentialSmoother::new(0.0, 0.2, 0.1);
        s.step(1.0);
        assert!(s.value > 0.0 && s.value < 1.0);
    }
}
