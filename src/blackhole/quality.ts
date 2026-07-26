/**
 * Quality tiers and the runtime governor that demotes between them.
 *
 * The initial guess comes from cheap capability signals; the governor is what
 * actually protects the frame rate, since no static probe reliably predicts
 * fill-rate on mobile GPUs.
 *
 * Per-pixel geodesic integration is far more expensive than drawing particles,
 * so `rayScale` and `maxSteps` are the load-bearing knobs here — resolution and
 * integration depth, not object counts. Temporal accumulation converges the
 * result over several frames, which is what makes marching at well below native
 * resolution acceptable.
 */

export type TierName = 'high' | 'medium' | 'low';

export interface Tier {
  name: TierName;
  /** Fraction of native resolution the geodesic march runs at. */
  rayScale: number;
  /** RK4 steps per ray. Compiled in as a #define, so changing it recompiles. */
  maxSteps: number;
  /** Angular step ceiling for the march, in radians. */
  maxStepAngle: number;
  /** Levels in the bloom pyramid. */
  bloomLevels: number;
  /** Upper bound on devicePixelRatio. */
  maxPixelRatio: number;
  /** Jets are volumetric and sampled every step — the first thing to drop. */
  jets: boolean;
}

export const TIERS: Record<TierName, Tier> = {
  high: {
    name: 'high',
    rayScale: 0.75,
    maxSteps: 256,
    maxStepAngle: 0.07,
    bloomLevels: 5,
    maxPixelRatio: 1.75,
    jets: true,
  },
  medium: {
    name: 'medium',
    rayScale: 0.55,
    maxSteps: 160,
    maxStepAngle: 0.10,
    bloomLevels: 4,
    maxPixelRatio: 1.5,
    jets: true,
  },
  low: {
    name: 'low',
    rayScale: 0.40,
    maxSteps: 96,
    maxStepAngle: 0.15,
    bloomLevels: 3,
    maxPixelRatio: 1.25,
    jets: false,
  },
};

const ORDER: TierName[] = ['high', 'medium', 'low'];

interface NavigatorWithMemory extends Navigator {
  deviceMemory?: number;
}

/** Best-effort starting tier from device signals available before first frame. */
export function detectTier(): Tier {
  if (typeof window === 'undefined') return TIERS.medium;

  const nav = navigator as NavigatorWithMemory;
  const cores = nav.hardwareConcurrency ?? 4;
  const memory = nav.deviceMemory ?? 4;
  const dpr = window.devicePixelRatio || 1;
  const shortSide = Math.min(window.innerWidth, window.innerHeight);
  const coarsePointer = window.matchMedia('(pointer: coarse)').matches;

  let score = 0;
  if (cores >= 8) score += 2;
  else if (cores >= 4) score += 1;

  if (memory >= 8) score += 2;
  else if (memory >= 4) score += 1;

  // A phone pushing a 3x display is the classic case where the static signals
  // look fine and the fill-rate does not.
  if (coarsePointer) score -= 2;
  if (dpr > 2.5) score -= 1;
  if (shortSide < 500) score -= 1;

  if (score >= 4) return TIERS.high;
  if (score >= 1) return TIERS.medium;
  return TIERS.low;
}

/**
 * Watches a rolling frame-time average and demotes one tier when the renderer
 * cannot hold the target. Demotion is one-way: oscillating between tiers is far
 * more noticeable than simply running at the lower one.
 */
export class QualityGovernor {
  private accum = 0;
  private frames = 0;
  private sustainedSlow = 0;
  private cooldown = 2.0;

  constructor(
    private tier: Tier,
    private readonly onDemote: (tier: Tier) => void,
    private readonly targetFps = 45,
    /** Seconds of sustained slowness before demoting. */
    private readonly patience = 1.5,
  ) {}

  get current(): Tier {
    return this.tier;
  }

  /** Feed one frame's delta, in seconds. */
  update(dt: number): void {
    // Ignore the first moments after startup and after a tier change, when
    // shader compilation dominates.
    if (this.cooldown > 0) {
      this.cooldown -= dt;
      return;
    }

    // A single long frame is usually a tab stall, not a rendering problem.
    if (dt > 0.5) return;

    this.accum += dt;
    this.frames += 1;
    if (this.accum < 0.5) return;

    const fps = this.frames / this.accum;
    this.accum = 0;
    this.frames = 0;

    if (fps < this.targetFps) this.sustainedSlow += 0.5;
    else this.sustainedSlow = 0;

    if (this.sustainedSlow >= this.patience) {
      this.sustainedSlow = 0;
      this.demote();
    }
  }

  private demote(): void {
    const idx = ORDER.indexOf(this.tier.name);
    if (idx < 0 || idx >= ORDER.length - 1) return;
    this.tier = TIERS[ORDER[idx + 1]];
    this.cooldown = 2.5;
    this.onDemote(this.tier);
  }
}
