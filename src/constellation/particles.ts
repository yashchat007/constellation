import { CONSTELLATION_CANVAS_BG } from "./palette";
import { CONSTELLATION_THEME } from "./types";

export interface StarParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  twinkle: number;
  glimmer: number;
  depth: number;
}

export interface ParticleFieldOptions {
  /** 0 = distant background, 1 = mid, 2 = foreground sparkle */
  layer: number;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createStarField(
  seed: number,
  count: number,
  options: ParticleFieldOptions = { layer: 1 },
): StarParticle[] {
  const rand = mulberry32(seed + options.layer * 7919);
  const spreadX = options.layer === 0 ? 3200 : 2600;
  const spreadY = options.layer === 0 ? 2800 : 2200;
  const out: StarParticle[] = [];
  for (let i = 0; i < count; i += 1) {
    const depth =
      options.layer === 0
        ? 0.08 + rand() * 0.25
        : options.layer === 2
          ? 0.65 + rand() * 0.35
          : 0.25 + rand() * 0.45;
    out.push({
      x: rand() * spreadX - spreadX / 2,
      y: rand() * spreadY - spreadY / 2,
      vx: (rand() - 0.5) * (0.004 + depth * 0.008),
      vy: (rand() - 0.5) * (0.004 + depth * 0.008),
      size:
        options.layer === 0
          ? 0.25 + rand() * 1.2
          : 0.4 + rand() * (2.2 + depth),
      alpha:
        options.layer === 0
          ? 0.04 + rand() * 0.12
          : 0.08 + rand() * 0.28,
      twinkle: rand() * Math.PI * 2,
      glimmer: rand(),
      depth,
    });
  }
  return out;
}

export interface ParticlePointer {
  worldX: number;
  worldY: number;
  active: boolean;
  strength: number;
}

export function updateStarField(
  particles: StarParticle[],
  dtMs: number,
  playing: boolean,
  activity = 1,
  pointer?: ParticlePointer,
  reducedMotion = false,
) {
  const speed = (reducedMotion ? 0.25 : playing ? 1 : 0.14) * activity;
  const dt = dtMs * 0.001 * speed;
  for (let i = 0; i < particles.length; i += 1) {
    const p = particles[i];
    const curl =
      Math.sin(p.y * 0.002 + p.twinkle) * 0.0004 +
      Math.cos(p.x * 0.0017 - p.twinkle * 0.5) * 0.00035;
    p.vx += curl * dt * 60;
    p.vy += Math.cos(p.x * 0.0021 + p.twinkle) * 0.00035 * dt * 60;

    if (pointer?.active && p.depth > 0.2) {
      const dx = p.x - pointer.worldX;
      const dy = p.y - pointer.worldY;
      const distSq = dx * dx + dy * dy;
      const radius = 140 + p.depth * 80;
      if (distSq < radius * radius && distSq > 1) {
        const dist = Math.sqrt(distSq);
        const force = ((1 - dist / radius) * pointer.strength * 0.0008) / dist;
        p.vx += dx * force * dt * 60;
        p.vy += dy * force * dt * 60;
      }
    }

    p.vx *= 0.992;
    p.vy *= 0.992;
    p.x += p.vx * dt * 60;
    p.y += p.vy * dt * 60;
    p.twinkle += dt * (playing ? 0.75 + p.depth * 0.4 : 0.2);

    const limX = 1600;
    const limY = 1300;
    if (p.x < -limX) p.x = limX;
    if (p.x > limX) p.x = -limX;
    if (p.y < -limY) p.y = limY;
    if (p.y > limY) p.y = -limY;
  }
}

export function drawStarField(
  ctx: CanvasRenderingContext2D,
  particles: StarParticle[],
  cameraX: number,
  cameraY: number,
  width: number,
  height: number,
  parallax = 0.05,
  particleColor?: string,
  sparkleColor?: string,
) {
  const pColor = particleColor ?? CONSTELLATION_THEME.textWarm;
  const sColor = sparkleColor ?? CONSTELLATION_THEME.textWarm;
  const cx = width * 0.5;
  const cy = height * 0.44;
  ctx.save();
  for (let i = 0; i < particles.length; i += 1) {
    const p = particles[i];
    const px = parallax * (0.35 + p.depth * 1.1);
    const sx = cx + (p.x - cameraX * px);
    const sy = cy + (p.y - cameraY * px);
    if (sx < -24 || sx > width + 24 || sy < -24 || sy > height + 24) {
      continue;
    }
    const flicker = 0.7 + Math.sin(p.twinkle) * 0.25;
    const glimmer =
      p.glimmer > 0.92 ? 0.85 + Math.sin(p.twinkle * 2.1) * 0.15 : 1;
    ctx.globalAlpha = p.alpha * flicker * glimmer * (0.65 + p.depth * 0.45);
    const warm = p.size > 1.6;
    ctx.fillStyle = warm ? sColor : pColor;
    ctx.beginPath();
    ctx.arc(sx, sy, p.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

export function drawPointerGlow(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  accent: string,
  strength: number,
) {
  if (strength <= 0.01) {
    return;
  }
  const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, 72);
  g.addColorStop(0, `${accent}${Math.round(28 * strength).toString(16).padStart(2, "0")}`);
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(sx, sy, 72, 0, Math.PI * 2);
  ctx.fill();
}

export function drawAtmosphereBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  _accent: string,
  _backgroundTint: string,
  _cameraX: number,
  _cameraY: number,
) {
  ctx.fillStyle = CONSTELLATION_CANVAS_BG || CONSTELLATION_THEME.background;
  ctx.fillRect(0, 0, width, height);

  const cx = width * 0.5;
  const cy = height * 0.44;
  const vignette = ctx.createRadialGradient(
    cx,
    cy,
    Math.min(width, height) * 0.18,
    cx,
    cy,
    Math.max(width, height) * 0.82,
  );
  vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
  vignette.addColorStop(1, "rgba(0, 0, 0, 0.45)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);
}
