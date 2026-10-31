import type { ConstellationGraph } from "../types";

/** Seeded 0..1 */
function hash01(seed: number, salt: number): number {
  let h = (seed ^ Math.imul(salt, 374761393)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export interface PhraseMotionProfile {
  orbitRadius: number;
  orbitSpeed: number;
  orbitPhase: number;
  freqA: number;
  freqB: number;
  freqC: number;
  ampA: number;
  ampB: number;
  ampC: number;
  driftPhase: number;
  burstPhase: number;
  localPullX: number;
  localPullY: number;
}

export interface MotionState {
  seed: number;
  profiles: PhraseMotionProfile[];
  driftFrom: { x: number; y: number }[];
  driftTo: { x: number; y: number }[];
  driftT: number;
  driftDuration: number;
}

export interface MotionEnergy {
  intensity: number;
  bass: number;
  mid: number;
  treble: number;
  onset: number;
}

export const DEFAULT_MOTION_ENERGY: MotionEnergy = {
  intensity: 0.35,
  bass: 0,
  mid: 0,
  treble: 0,
  onset: 0,
};

function buildProfile(seed: number, lineIndex: number): PhraseMotionProfile {
  const s = seed + lineIndex * 977;
  return {
    orbitRadius: 6 + hash01(s, 1) * 18,
    orbitSpeed: 0.18 + hash01(s, 2) * 0.42,
    orbitPhase: hash01(s, 3) * Math.PI * 2,
    freqA: 0.31 + hash01(s, 4) * 0.55,
    freqB: 0.47 + hash01(s, 5) * 0.38,
    freqC: 0.12 + hash01(s, 6) * 0.22,
    ampA: 0.55 + hash01(s, 7) * 0.45,
    ampB: 0.35 + hash01(s, 8) * 0.4,
    ampC: 0.2 + hash01(s, 9) * 0.35,
    driftPhase: hash01(s, 10) * Math.PI * 2,
    burstPhase: hash01(s, 11) * Math.PI * 2,
    localPullX: (hash01(s, 12) - 0.5) * 14,
    localPullY: (hash01(s, 13) - 0.5) * 14,
  };
}

export function createMotionState(graph: ConstellationGraph): MotionState {
  const n = graph.lineCount;
  const profiles = Array.from({ length: n }, (_, i) =>
    buildProfile(graph.seed, i),
  );
  const driftFrom = profiles.map((p) => ({
    x: Math.cos(p.driftPhase) * 8,
    y: Math.sin(p.driftPhase * 0.83) * 8,
  }));
  return {
    seed: graph.seed,
    profiles,
    driftFrom: driftFrom.map((d) => ({ ...d })),
    driftTo: driftFrom.map((d) => ({ ...d })),
    driftT: 1,
    driftDuration: 4.5 + hash01(graph.seed, 99) * 3,
  };
}

function pickNewDriftTarget(seed: number, lineIndex: number): { x: number; y: number } {
  const a = hash01(seed, lineIndex + 400) * Math.PI * 2;
  const r = 6 + hash01(seed, lineIndex + 401) * 16;
  return { x: Math.cos(a) * r, y: Math.sin(a * 0.77) * r };
}

/** Advance slow drift targets — call once per frame. */
export function tickMotionState(
  state: MotionState,
  dtMs: number,
  playing: boolean,
  energy: MotionEnergy,
  reducedMotion: boolean,
) {
  const rate = reducedMotion ? 0.15 : playing ? 0.35 + energy.intensity * 0.4 : 0.08;
  state.driftT += (dtMs * 0.001 * rate) / state.driftDuration;
  if (state.driftT >= 1) {
    state.driftT = 0;
    state.driftDuration = 3.5 + hash01(state.seed, 101) * 4;
    for (let i = 0; i < state.driftFrom.length; i += 1) {
      state.driftFrom[i] = { ...state.driftTo[i] };
      state.driftTo[i] = pickNewDriftTarget(state.seed, i);
    }
  }
}

function smoothDrift(
  state: MotionState,
  lineIndex: number,
): { x: number; y: number } {
  const u = state.driftT * state.driftT * (3 - 2 * state.driftT);
  const a = state.driftFrom[lineIndex] ?? { x: 0, y: 0 };
  const b = state.driftTo[lineIndex] ?? a;
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
}

export function phraseMotionOffset(
  state: MotionState,
  lineIndex: number,
  timeSec: number,
  playing: boolean,
  motionScale = 1,
  energy: MotionEnergy = DEFAULT_MOTION_ENERGY,
  reducedMotion = false,
): { dx: number; dy: number } {
  const profile = state.profiles[lineIndex];
  if (!profile) {
    return { dx: 0, dy: 0 };
  }

  const playFactor = reducedMotion ? 0.2 : playing ? 1 : 0.22;
  const intensity =
    playFactor * motionScale * (0.45 + energy.intensity * 0.85 + energy.mid * 0.25);
  const bassBoost = 1 + energy.bass * 0.35;
  const t = timeSec;

  const orbit =
    profile.orbitRadius *
    bassBoost *
    intensity *
    0.55;
  const ox = Math.cos(t * profile.orbitSpeed + profile.orbitPhase) * orbit;
  const oy = Math.sin(t * profile.orbitSpeed * 0.86 + profile.orbitPhase * 1.07) * orbit;

  const wobbleX =
    (Math.sin(t * profile.freqA + profile.orbitPhase) * profile.ampA +
      Math.sin(t * profile.freqB + profile.orbitPhase * 1.3) * profile.ampB +
      Math.sin(t * profile.freqC + lineIndex * 0.17) * profile.ampC) *
    7 *
    intensity;
  const wobbleY =
    (Math.cos(t * profile.freqB + profile.orbitPhase * 0.9) * profile.ampB +
      Math.cos(t * profile.freqA * 0.73 + lineIndex * 0.11) * profile.ampA +
      Math.sin(t * profile.freqC * 1.4 + profile.orbitPhase) * profile.ampC) *
    7 *
    intensity;

  const drift = smoothDrift(state, lineIndex);
  const burst =
    Math.max(0, Math.sin(t * 0.9 + profile.burstPhase)) *
    energy.onset *
    12 *
    intensity;

  const pullX = profile.localPullX * intensity * 0.35;
  const pullY = profile.localPullY * intensity * 0.35;

  return {
    dx: ox + wobbleX + drift.x * intensity + pullX + burst * 0.35,
    dy: oy + wobbleY + drift.y * intensity + pullY + burst * 0.28,
  };
}

export function edgeMotionOffset(
  state: MotionState,
  edgeIndex: number,
  timeSec: number,
  playing: boolean,
  energy: MotionEnergy = DEFAULT_MOTION_ENERGY,
): { dx: number; dy: number } {
  const amp = (playing ? 2.5 : 0.6) * (0.6 + energy.mid * 0.5);
  const t =
    timeSec * (playing ? 0.35 : 0.07) +
    edgeIndex * 0.41 +
    state.seed * 0.0001;
  return {
    dx: Math.sin(t * 0.8) * amp,
    dy: Math.cos(t * 0.63) * amp * 0.85,
  };
}
