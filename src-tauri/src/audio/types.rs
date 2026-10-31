use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioFeatureSnapshot {
    pub capture_available: bool,
    pub is_capturing: bool,
    pub is_signal_present: bool,
    pub sample_rate: u32,
    pub rms_energy: f32,
    pub normalized_energy: f32,
    pub bass_energy: f32,
    pub low_mid_energy: f32,
    pub mid_energy: f32,
    pub high_mid_energy: f32,
    pub treble_energy: f32,
    pub spectral_centroid: f32,
    pub onset_strength: f32,
    pub estimated_bpm: Option<f32>,
    pub timestamp_ms: u64,
}

impl Default for AudioFeatureSnapshot {
    fn default() -> Self {
        Self {
            capture_available: cfg!(windows),
            is_capturing: false,
            is_signal_present: false,
            sample_rate: 48_000,
            rms_energy: 0.0,
            normalized_energy: 0.0,
            bass_energy: 0.0,
            low_mid_energy: 0.0,
            mid_energy: 0.0,
            high_mid_energy: 0.0,
            treble_energy: 0.0,
            spectral_centroid: 0.0,
            onset_strength: 0.0,
            estimated_bpm: None,
            timestamp_ms: 0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioCaptureStatus {
    pub capture_available: bool,
    pub is_capturing: bool,
    pub last_error: Option<String>,
    pub sample_rate: u32,
    pub chunks_received: u64,
    pub samples_received: u64,
}

impl Default for AudioCaptureStatus {
    fn default() -> Self {
        Self {
            capture_available: cfg!(windows),
            is_capturing: false,
            last_error: None,
            sample_rate: 48_000,
            chunks_received: 0,
            samples_received: 0,
        }
    }
}
