//! WASAPI loopback capture — callback path only copies samples to channel.

use crate::audio::diag::{on_chunk, reset_capture_stats, set_sample_rate};
use crossbeam_channel::Sender;
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;
use wasapi::{get_default_device, initialize_mta, Direction, StreamMode};

pub fn spawn_capture_worker(
    tx: Sender<Vec<f32>>,
    stop: Arc<AtomicBool>,
) -> Result<JoinHandle<()>, String> {
    let handle = std::thread::Builder::new()
        .name("constellation-audio-capture".into())
        .spawn(move || {
            while !stop.load(Ordering::Relaxed) {
                match capture_session(&tx, &stop) {
                    Ok(()) => break,
                    Err(e) => {
                        if cfg!(debug_assertions)
                            || std::env::var_os("CONSTELLATION_LOG").is_some()
                        {
                            eprintln!("[constellation:audio] capture session ended: {e}");
                        }
                        if stop.load(Ordering::Relaxed) {
                            break;
                        }
                        std::thread::sleep(std::time::Duration::from_millis(800));
                    }
                }
            }
        })
        .map_err(|e| e.to_string())?;
    Ok(handle)
}

fn capture_session(tx: &Sender<Vec<f32>>, stop: &Arc<AtomicBool>) -> Result<(), String> {
    let hr = initialize_mta();
    if hr.is_err() {
        return Err("COM MTA initialization failed".into());
    }

    let device = get_default_device(&Direction::Render).map_err(|e| e.to_string())?;
    let mut audio_client = device.get_iaudioclient().map_err(|e| e.to_string())?;
    let mix_format = audio_client.get_mixformat().map_err(|e| e.to_string())?;
    let (_, min_time) = audio_client.get_device_period().map_err(|e| e.to_string())?;
    let mode = StreamMode::EventsShared {
        autoconvert: true,
        buffer_duration_hns: min_time,
    };
    audio_client
        .initialize_client(&mix_format, &Direction::Capture, &mode)
        .map_err(|e| format!("loopback init: {e}"))?;

    let h_event = audio_client.set_get_eventhandle().map_err(|e| e.to_string())?;
    let capture_client = audio_client.get_audiocaptureclient().map_err(|e| e.to_string())?;
    set_sample_rate(mix_format.get_samplespersec());
    reset_capture_stats();
    if cfg!(debug_assertions) || std::env::var_os("CONSTELLATION_LOG").is_some() {
        eprintln!(
            "[constellation:audio:diag] capture_start sample_rate={} channels={} bits={}",
            mix_format.get_samplespersec(),
            mix_format.get_nchannels(),
            mix_format.get_bitspersample()
        );
    }

    let blockalign = mix_format.get_blockalign() as usize;
    let channels = mix_format.get_nchannels().max(1) as usize;
    let bits = mix_format.get_bitspersample();
    let is_float = mix_format
        .get_subformat()
        .map(|t| matches!(t, wasapi::SampleType::Float))
        .unwrap_or(true);

    let mut deque: VecDeque<u8> = VecDeque::with_capacity(blockalign * 4096);
    audio_client.start_stream().map_err(|e| e.to_string())?;

    const CHUNK_FRAMES: usize = 1024;

    while !stop.load(Ordering::Relaxed) {
        capture_client
            .read_from_device_to_deque(&mut deque)
            .map_err(|e| e.to_string())?;

        while deque.len() >= blockalign * CHUNK_FRAMES {
            let byte_len = blockalign * CHUNK_FRAMES;
            let mut bytes = Vec::with_capacity(byte_len);
            for _ in 0..byte_len {
                if let Some(b) = deque.pop_front() {
                    bytes.push(b);
                }
            }
            let mono = bytes_to_mono_f32(&bytes, channels, bits, is_float);
            if !mono.is_empty() {
                on_chunk(&mono);
                let _ = tx.try_send(mono);
            }
        }

        let _ = h_event.wait_for_event(50);
    }

    let _ = audio_client.stop_stream();
    Ok(())
}

fn bytes_to_mono_f32(bytes: &[u8], channels: usize, bits: u16, is_float: bool) -> Vec<f32> {
    if is_float && bits == 32 {
        let mut out = Vec::with_capacity(bytes.len() / (4 * channels));
        let mut idx = 0;
        while idx + 4 * channels <= bytes.len() {
            let mut sum = 0.0f32;
            for c in 0..channels {
                let off = idx + c * 4;
                sum += f32::from_le_bytes([
                    bytes[off],
                    bytes[off + 1],
                    bytes[off + 2],
                    bytes[off + 3],
                ]);
            }
            out.push(sum / channels as f32);
            idx += 4 * channels;
        }
        return out;
    }
    if bits == 16 {
        let mut out = Vec::with_capacity(bytes.len() / (2 * channels));
        let mut idx = 0;
        while idx + 2 * channels <= bytes.len() {
            let mut sum = 0.0f32;
            for c in 0..channels {
                let off = idx + c * 2;
                let v = i16::from_le_bytes([bytes[off], bytes[off + 1]]) as f32 / 32768.0;
                sum += v;
            }
            out.push(sum / channels as f32);
            idx += 2 * channels;
        }
        return out;
    }
    Vec::new()
}
