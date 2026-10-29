/**
 * Particle simulation in flat typed arrays, so a GPU sprite layer can upload
 * them directly as instance attributes. Pure (no three.js) for tests.
 */

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export interface SpawnOptions {
  count: number;
  origin: Vec3Like;
  color: RGB;
  /** Brightness multiplier (>1 is brighter than white and blooms). */
  intensity?: number;
  speed: number;
  life: number;
  size: number;
  /** Units/s² along Y (negative falls, positive rises). */
  gravity?: number;
  /** Fraction of velocity lost per second. */
  drag?: number;
  /** Spin around the spawn point (wind). */
  swirl?: number;
  /** Horizontal spread of the initial direction (1 = all around). */
  spread?: number;
  /** Upward bias of the initial direction. */
  up?: number;
  /** Also travel toward this point over the particle's life (energy streams). */
  toward?: Vec3Like;
  /** Seconds of motion blur along the screen-space velocity (sparks become streaks). */
  stretch?: number;
  /** Random start offset around the origin. */
  jitter?: number;
}

/**
 * Sprites: position, velocity, colour (rgb + intensity) and params (life,
 * maxLife, size, stretch). A particle with maxLife 0 is dead and not drawn.
 */
export class ParticlePool {
  readonly capacity: number;
  readonly pos: Float32Array;
  readonly vel: Float32Array;
  readonly color: Float32Array;
  readonly params: Float32Array;
  private readonly gravity: Float32Array;
  private readonly drag: Float32Array;
  private readonly swirl: Float32Array;
  private readonly center: Float32Array;
  private cursor = 0;

  constructor(capacity: number) {
    this.capacity = Math.max(0, Math.floor(capacity));
    const n = this.capacity;
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.color = new Float32Array(n * 4);
    this.params = new Float32Array(n * 4);
    this.gravity = new Float32Array(n);
    this.drag = new Float32Array(n);
    this.swirl = new Float32Array(n);
    this.center = new Float32Array(n * 3);
  }

  /** Spawn up to `count` particles (oldest are recycled). Returns how many. */
  spawn(o: SpawnOptions, rand: () => number = Math.random): number {
    if (this.capacity === 0) return 0;
    const n = Math.min(Math.max(0, Math.round(o.count)), this.capacity);
    const spread = o.spread ?? 1;
    const up = o.up ?? 1;
    const k = o.intensity ?? 1;
    const jitter = o.jitter ?? 0;
    for (let c = 0; c < n; c++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.capacity;
      const i3 = i * 3;
      const i4 = i * 4;
      this.pos[i3] = o.origin.x + (rand() - 0.5) * 2 * jitter;
      this.pos[i3 + 1] = o.origin.y + (rand() - 0.5) * 2 * jitter;
      this.pos[i3 + 2] = o.origin.z + (rand() - 0.5) * 2 * jitter;
      let vx = (rand() - 0.5) * 2 * spread;
      let vy = rand() * up;
      let vz = (rand() - 0.5) * 2 * spread;
      const len = Math.hypot(vx, vy, vz) || 1;
      const sp = o.speed * (0.4 + rand() * 0.8);
      vx = (vx / len) * sp;
      vy = (vy / len) * sp;
      vz = (vz / len) * sp;
      const maxLife = o.life * (0.6 + rand() * 0.6);
      if (o.toward) {
        // Arrive at the target over the particle's life.
        vx += (o.toward.x - o.origin.x) / maxLife;
        vy += (o.toward.y - o.origin.y) / maxLife;
        vz += (o.toward.z - o.origin.z) / maxLife;
      }
      this.vel[i3] = vx;
      this.vel[i3 + 1] = vy;
      this.vel[i3 + 2] = vz;
      const shade = 1 + (rand() - 0.3) * 0.25;
      this.color[i4] = o.color.r * shade;
      this.color[i4 + 1] = o.color.g * shade;
      this.color[i4 + 2] = o.color.b * shade;
      this.color[i4 + 3] = k;
      this.params[i4] = 0;
      this.params[i4 + 1] = maxLife;
      this.params[i4 + 2] = o.size * (0.7 + rand() * 0.6);
      this.params[i4 + 3] = o.stretch ?? 0;
      this.gravity[i] = o.gravity ?? -6;
      this.drag[i] = o.drag ?? 0.8;
      this.swirl[i] = o.swirl ?? 0;
      this.center[i3] = o.origin.x;
      this.center[i3 + 1] = o.origin.y;
      this.center[i3 + 2] = o.origin.z;
    }
    return n;
  }

  step(dt: number): void {
    if (dt <= 0) return;
    for (let i = 0; i < this.capacity; i++) {
      const i3 = i * 3;
      const i4 = i * 4;
      const maxLife = this.params[i4 + 1]!;
      if (maxLife <= 0) continue;
      const life = this.params[i4]! + dt;
      if (life >= maxLife) {
        this.params[i4 + 1] = 0;
        continue;
      }
      this.params[i4] = life;
      const sw = this.swirl[i]!;
      if (sw) {
        const dx = this.pos[i3]! - this.center[i3]!;
        const dz = this.pos[i3 + 2]! - this.center[i3 + 2]!;
        this.vel[i3] = this.vel[i3]! - dz * sw * dt;
        this.vel[i3 + 2] = this.vel[i3 + 2]! + dx * sw * dt;
      }
      this.vel[i3 + 1] = this.vel[i3 + 1]! + this.gravity[i]! * dt;
      const keep = Math.max(0, 1 - dt * this.drag[i]!);
      this.vel[i3] = this.vel[i3]! * keep;
      this.vel[i3 + 1] = this.vel[i3 + 1]! * keep;
      this.vel[i3 + 2] = this.vel[i3 + 2]! * keep;
      this.pos[i3] = this.pos[i3]! + this.vel[i3]! * dt;
      this.pos[i3 + 1] = this.pos[i3 + 1]! + this.vel[i3 + 1]! * dt;
      this.pos[i3 + 2] = this.pos[i3 + 2]! + this.vel[i3 + 2]! * dt;
    }
  }

  alive(): number {
    let n = 0;
    for (let i = 0; i < this.capacity; i++) if (this.params[i * 4 + 1]! > 0) n++;
    return n;
  }
}

export interface DebrisOptions {
  count: number;
  origin: Vec3Like;
  speed: number;
  life: number;
  size: number;
  up?: number;
}

/**
 * Tumbling armour chips: gravity, a bounce on the stage floor (y = 0 inside
 * the ring), then they settle and vanish. Matrices are built by the renderer.
 */
export class DebrisPool {
  readonly capacity: number;
  readonly pos: Float32Array;
  readonly vel: Float32Array;
  /** Euler angles and their rates. */
  readonly rot: Float32Array;
  readonly spin: Float32Array;
  /** life, maxLife, size. */
  readonly params: Float32Array;
  private cursor = 0;
  static readonly FLOOR_RADIUS = 13;

  constructor(capacity: number) {
    this.capacity = Math.max(0, Math.floor(capacity));
    const n = this.capacity;
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.rot = new Float32Array(n * 3);
    this.spin = new Float32Array(n * 3);
    this.params = new Float32Array(n * 3);
  }

  spawn(o: DebrisOptions, rand: () => number = Math.random): number {
    if (this.capacity === 0) return 0;
    const n = Math.min(Math.max(0, Math.round(o.count)), this.capacity);
    for (let c = 0; c < n; c++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.capacity;
      const i3 = i * 3;
      const a = rand() * Math.PI * 2;
      const sp = o.speed * (0.5 + rand() * 0.7);
      this.pos[i3] = o.origin.x;
      this.pos[i3 + 1] = o.origin.y;
      this.pos[i3 + 2] = o.origin.z;
      this.vel[i3] = Math.cos(a) * sp;
      this.vel[i3 + 1] = (0.4 + rand() * (o.up ?? 1)) * sp;
      this.vel[i3 + 2] = Math.sin(a) * sp;
      for (let k = 0; k < 3; k++) {
        this.rot[i3 + k] = rand() * Math.PI * 2;
        this.spin[i3 + k] = (rand() - 0.5) * 14;
      }
      this.params[i3] = 0;
      this.params[i3 + 1] = o.life * (0.7 + rand() * 0.6);
      this.params[i3 + 2] = o.size * (0.5 + rand());
    }
    return n;
  }

  step(dt: number): void {
    if (dt <= 0) return;
    for (let i = 0; i < this.capacity; i++) {
      const i3 = i * 3;
      const maxLife = this.params[i3 + 1]!;
      if (maxLife <= 0) continue;
      const life = this.params[i3]! + dt;
      if (life >= maxLife) {
        this.params[i3 + 1] = 0;
        continue;
      }
      this.params[i3] = life;
      this.vel[i3 + 1] = this.vel[i3 + 1]! - 14 * dt;
      for (let k = 0; k < 3; k++) {
        this.pos[i3 + k] = this.pos[i3 + k]! + this.vel[i3 + k]! * dt;
        this.rot[i3 + k] = this.rot[i3 + k]! + this.spin[i3 + k]! * dt;
      }
      const onStage = Math.hypot(this.pos[i3]!, this.pos[i3 + 2]!) < DebrisPool.FLOOR_RADIUS;
      if (onStage && this.pos[i3 + 1]! < 0 && this.vel[i3 + 1]! < 0) {
        // Bounce low and skid; spin dies down.
        this.pos[i3 + 1] = 0;
        this.vel[i3 + 1] = -this.vel[i3 + 1]! * 0.3;
        this.vel[i3] = this.vel[i3]! * 0.6;
        this.vel[i3 + 2] = this.vel[i3 + 2]! * 0.6;
        for (let k = 0; k < 3; k++) this.spin[i3 + k] = this.spin[i3 + k]! * 0.5;
      }
    }
  }

  alive(): number {
    let n = 0;
    for (let i = 0; i < this.capacity; i++) if (this.params[i * 3 + 1]! > 0) n++;
    return n;
  }
}

/**
 * A camera-facing strip along a polyline (lightning, beams): two vertices per
 * point, offset across the line and across the view direction. Writes into
 * `out` (length ≥ points × 6) and returns the number of floats written.
 */
export function buildRibbon(
  points: readonly Vec3Like[],
  eye: Vec3Like,
  width: number,
  out: Float32Array,
): number {
  const n = points.length;
  if (n < 2) return 0;
  for (let i = 0; i < n; i++) {
    const p = points[i]!;
    const a = points[Math.max(0, i - 1)]!;
    const b = points[Math.min(n - 1, i + 1)]!;
    // Tangent × (eye − p) gives the across direction, facing the camera.
    const tx = b.x - a.x;
    const ty = b.y - a.y;
    const tz = b.z - a.z;
    const vx = eye.x - p.x;
    const vy = eye.y - p.y;
    const vz = eye.z - p.z;
    let cx = ty * vz - tz * vy;
    let cy = tz * vx - tx * vz;
    let cz = tx * vy - ty * vx;
    const len = Math.hypot(cx, cy, cz) || 1;
    // Thinner at both ends so a bolt tapers.
    const taper = Math.sin(((i + 0.5) / n) * Math.PI) * 0.7 + 0.3;
    const w = (width * taper) / 2 / len;
    cx *= w;
    cy *= w;
    cz *= w;
    const o = i * 6;
    out[o] = p.x - cx;
    out[o + 1] = p.y - cy;
    out[o + 2] = p.z - cz;
    out[o + 3] = p.x + cx;
    out[o + 4] = p.y + cy;
    out[o + 5] = p.z + cz;
  }
  return n * 6;
}
