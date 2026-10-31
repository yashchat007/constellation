import type { AudioCaptureStatus, AudioFeatureSnapshot } from "../types";

let latestAudio: AudioFeatureSnapshot | null = null;
let latestStatus: AudioCaptureStatus | null = null;

export function setLatestAudioSnapshot(snapshot: AudioFeatureSnapshot) {
  latestAudio = snapshot;
}

export function getLatestAudioSnapshot(): AudioFeatureSnapshot | null {
  return latestAudio;
}

export function setAudioCaptureStatus(status: AudioCaptureStatus) {
  latestStatus = status;
}

export function getAudioCaptureStatus(): AudioCaptureStatus | null {
  return latestStatus;
}

export function parseAudioSnapshot(raw: unknown): AudioFeatureSnapshot | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const o = raw as Record<string, unknown>;
  return {
    captureAvailable: Boolean(o.captureAvailable),
    isCapturing: Boolean(o.isCapturing),
    isSignalPresent: Boolean(o.isSignalPresent),
    sampleRate: Number(o.sampleRate) || 48000,
    rmsEnergy: Number(o.rmsEnergy) || 0,
    normalizedEnergy: Number(o.normalizedEnergy) || 0,
    bassEnergy: Number(o.bassEnergy) || 0,
    lowMidEnergy: Number(o.lowMidEnergy) || 0,
    midEnergy: Number(o.midEnergy) || 0,
    highMidEnergy: Number(o.highMidEnergy) || 0,
    trebleEnergy: Number(o.trebleEnergy) || 0,
    spectralCentroid: Number(o.spectralCentroid) || 0,
    onsetStrength: Number(o.onsetStrength) || 0,
    estimatedBpm:
      o.estimatedBpm == null ? null : Number(o.estimatedBpm) || null,
    timestampMs: Number(o.timestampMs) || 0,
  };
}
