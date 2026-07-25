/**
 * Quality tiers and the runtime governor that demotes between them.
 *
 * The initial guess comes from cheap capability signals; the governor is what
 * actually protects the frame rate, since no static probe reliably predicts
 * fill-rate on mobile GPUs.
 */

export type TierName = 'high' | 'medium' | 'low';

export interface Tier {
  name: TierName;
  /** Number of accretion-disk particles. */
  particles: number;
  /** Multiplier on the main render-target resolution. */
  renderScale: number;
  /** Ping-pong blur iterations in the bloom chain. */
  bloomIterations: number;
  /** Upper bound on devicePixelRatio. */
  maxPixelRatio: number;
}

export const TIERS: Record<TierName, Tier> = {
  high: {
    name: 'high',
    particles: 240_000,
    renderScale: 1.0,
    bloomIterations: 3,
    maxPixelRatio: 2,
  },
  medium: {
    name: 'medium',
    particles: 120_000,
    renderScale: 0.85,
    bloomIterations: 2,
    maxPixelRatio: 1.75,
  },
  low: {
    name: 'low',
    particles: 45_000,
    renderScale: 0.7,
    bloomIterations: 1,
    maxPixelRatio: 1.5,
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
  private cooldown = 1.5;

  constructor(
    private tier: Tier,
    private readonly onDemote: (tier: Tier) => void,
    private readonly targetFps = 50,
    /** Seconds of sustained slowness before demoting. */
    private readonly patience = 2.0,
  ) {}

  get current(): Tier {
    return this.tier;
  }

  /** Feed one frame's delta, in seconds. */
  update(dt: number): void {
    // Ignore the first moments after startup and after a tier change, when
    // shader compilation and buffer uploads dominate.
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

    if (fps < this.targetFps) {
      this.sustainedSlow += 0.5;
    } else {
      this.sustainedSlow = 0;
    }

    if (this.sustainedSlow >= this.patience) {
      this.sustainedSlow = 0;
      this.demote();
    }
  }

  private demote(): void {
    const idx = ORDER.indexOf(this.tier.name);
    if (idx < 0 || idx >= ORDER.length - 1) return;
    this.tier = TIERS[ORDER[idx + 1]];
    this.cooldown = 2.0;
    this.onDemote(this.tier);
  }
}
