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

export type TierName = 'high' | 'medium' | 'low' | 'floor';

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

/**
 * What actually decides how this looks is the *march density*
 *
 *     D = min(devicePixelRatio, maxPixelRatio) · rayScale
 *
 * — geodesic samples per CSS pixel — and the upscale to the physical panel that
 * follows from it, `U = devicePixelRatio / D`.
 *
 * That number is why the phone looked nothing like the laptop. A laptop at
 * `high` with dpr 2 gets D = 1.575 and U = 1.27×. A phone at dpr 3 hit the old
 * `low` cap of 1.25 and, with rayScale 0.50, got **D = 0.625 and U = 4.8×**: the
 * march ran 246 px across and was stretched onto a 1179 px panel. The photon
 * ring is about 4.6 px wide on the laptop, so it landed at roughly one pixel and
 * disappeared. Nothing survives that, which is why it read as a noisy blob
 * rather than as a black hole.
 *
 * On a phone the cap is the binding constraint, not `rayScale` — dpr is 3, so
 * raising the cap buys resolution far more directly than raising the scale.
 *
 * The other half is `maxStepAngle`. The march steps by
 * `maxStepAngle · clamp(r / 6Rs, 0.07, 1)`, so 0.15 rad samples the winding
 * region outside the photon sphere less than half as finely as 0.07 — which
 * degrades the *shape* of the lensed arcs, not merely their sharpness.
 *
 * Per-frame integration cost goes as `w · h · D² · maxSteps`. Because a phone
 * has roughly an eighth of a laptop's CSS area, the old `low` was doing about
 * 1/66 of the laptop's work. The ladder below spends about 5.7× that at `low`
 * and is still an order of magnitude under the laptop.
 */
export const TIERS: Record<TierName, Tier> = {
  high: {
    name: 'high',
    rayScale: 0.90,
    maxSteps: 320,
    maxStepAngle: 0.07,
    bloomLevels: 5,
    maxPixelRatio: 1.75,
    jets: true,
  },
  medium: {
    name: 'medium',
    rayScale: 0.72,
    maxSteps: 260,
    maxStepAngle: 0.085,
    bloomLevels: 5,
    maxPixelRatio: 2.0,
    jets: true,
  },
  low: {
    name: 'low',
    rayScale: 0.66,
    maxSteps: 200,
    maxStepAngle: 0.10,
    bloomLevels: 4,
    maxPixelRatio: 1.75,
    jets: true,
  },
  // The old `low`, kept as the bottom of the ladder. The governor only ever
  // demotes, so raising `low` without leaving something beneath it would have
  // taken away its escape route on hardware that genuinely cannot cope.
  floor: {
    name: 'floor',
    rayScale: 0.50,
    maxSteps: 120,
    maxStepAngle: 0.15,
    bloomLevels: 3,
    maxPixelRatio: 1.25,
    jets: false,
  },
};

const ORDER: TierName[] = ['high', 'medium', 'low', 'floor'];

interface NavigatorWithMemory extends Navigator {
  deviceMemory?: number;
}

/** Best-effort starting tier from device signals available before first frame. */
export function detectTier(): Tier {
  if (typeof window === 'undefined') return TIERS.medium;

  const nav = navigator as NavigatorWithMemory;
  const cores = nav.hardwareConcurrency ?? 4;
  const memory = nav.deviceMemory ?? 4;
  const coarsePointer = window.matchMedia('(pointer: coarse)').matches;

  let score = 0;
  if (cores >= 8) score += 2;
  else if (cores >= 4) score += 1;

  if (memory >= 8) score += 2;
  else if (memory >= 4) score += 1;

  // Touch hardware is still worth a real penalty: it is the one signal that
  // reliably means "mobile GPU".
  if (coarsePointer) score -= 2;

  // Deliberately no longer penalised: high devicePixelRatio and a small short
  // side. Both were double-counting. A dense phone screen does not mean more
  // work — `maxPixelRatio` already caps what is rendered per CSS pixel, and a
  // small viewport means *fewer* CSS pixels to cover, so the two together made
  // the cheapest devices score lowest. Stacked on the touch penalty they pushed
  // a perfectly ordinary phone (4 cores, 8 GB) to −1, i.e. the bottom tier, and
  // that is what has been rendering the hole as a blob. The governor demotes
  // within about two seconds if this guess is too generous, and it now has
  // three rungs to fall through; a pessimistic static probe cannot be undone.

  if (score >= 4) return TIERS.high;
  if (score >= 1) return TIERS.medium;
  if (score >= -1) return TIERS.low;
  return TIERS.floor;
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
