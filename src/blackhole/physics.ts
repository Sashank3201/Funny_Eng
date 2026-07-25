/**
 * Schwarzschild black hole constants and formulae.
 *
 * Everything is in geometric units where the Schwarzschild radius Rs = 1
 * (so G = c = 1 and the mass M = Rs / 2 = 0.5). Working in units of Rs keeps
 * every interesting length a small, readable number and keeps the shaders free
 * of astronomical magnitudes.
 *
 * This module is the single source of truth: the same values are injected into
 * the GLSL as #defines via `glslPhysicsDefines()`, so TS and the shaders can
 * never drift apart.
 */

/** Schwarzschild radius, our unit of length. Rs = 2GM/c². */
export const RS = 1.0;

/** Mass in geometric units: M = Rs / 2. */
export const MASS = RS / 2;

/**
 * Photon sphere: the radius at which light itself orbits in a circle.
 * r_ph = 3GM/c² = 1.5 Rs
 */
export const PHOTON_SPHERE = 1.5 * RS;

/**
 * Innermost stable circular orbit. Inside this, matter cannot hold an orbit and
 * plunges through the horizon, so it is the inner edge of the accretion disk.
 * r_isco = 6GM/c² = 3 Rs
 */
export const ISCO = 3.0 * RS;

/**
 * Apparent radius of the black hole's shadow as seen by a distant observer.
 * Light with impact parameter below this is captured. b_crit = 3√3 GM/c² = (√27/2) Rs
 * Note this is noticeably larger than the horizon itself — the hole looks bigger
 * than it is because it bends light inward.
 */
export const SHADOW_RADIUS = (Math.sqrt(27) / 2) * RS;

/**
 * Outer edge of the modelled accretion disk. Real disks extend far further,
 * but past ~10 Rs the emission is negligible and the particles only thin out
 * into visible speckle.
 */
export const DISK_OUTER = 9.0 * RS;

/** Inner edge of the accretion disk — matter cannot orbit inside the ISCO. */
export const DISK_INNER = ISCO;

/**
 * Keplerian angular velocity of a circular orbit at radius r.
 * Ω = √(GM / r³). Inner material sweeps around dramatically faster than outer
 * material — this differential rotation is what shears the disk into streaks.
 */
export function keplerianOmega(r: number): number {
  return Math.sqrt(MASS / (r * r * r));
}

/**
 * Orbital speed as a fraction of c: β = √(GM / r).
 * At the ISCO (r = 3Rs) this is ≈ 0.41c, which is why the Doppler asymmetry is
 * so pronounced.
 */
export function orbitalBeta(r: number): number {
  return Math.sqrt(MASS / r);
}

/**
 * Relativistic Doppler factor δ = 1 / (γ(1 − β·n̂)) for an emitter moving with
 * velocity β whose line-of-sight component toward the observer is `betaLos`.
 * Observed intensity scales as δ³ (or δ⁴ bolometric), which is what makes the
 * approaching limb of the disk so much brighter than the receding one.
 */
export function dopplerFactor(beta: number, betaLos: number): number {
  const gamma = 1 / Math.sqrt(1 - beta * beta);
  return 1 / (gamma * (1 - betaLos));
}

/**
 * Gravitational redshift factor √(1 − Rs/r): light climbing out of the well
 * loses energy, so the innermost disk is dimmed and reddened by gravity even
 * where Doppler beaming brightens it.
 */
export function gravitationalRedshift(r: number): number {
  return Math.sqrt(Math.max(0, 1 - RS / r));
}

/**
 * Weak-field light deflection angle α = 4GM/(c²b) = 2Rs/b for a ray with impact
 * parameter b. Drives the lensing pass that smears the background starfield
 * into arcs around the shadow.
 */
export function deflectionAngle(b: number): number {
  return (2 * RS) / b;
}

/** Shakura–Sunyaev thin-disk temperature profile, T ∝ r^(−3/4). */
export const TEMPERATURE_EXPONENT = 0.75;

/**
 * GLSL #define block mirroring the constants above. Prepended to every shader
 * so there is exactly one definition of each number in the project.
 */
export function glslPhysicsDefines(): string {
  return [
    `#define RS ${RS.toFixed(6)}`,
    `#define MASS ${MASS.toFixed(6)}`,
    `#define PHOTON_SPHERE ${PHOTON_SPHERE.toFixed(6)}`,
    `#define ISCO ${ISCO.toFixed(6)}`,
    `#define SHADOW_RADIUS ${SHADOW_RADIUS.toFixed(6)}`,
    `#define DISK_INNER ${DISK_INNER.toFixed(6)}`,
    `#define DISK_OUTER ${DISK_OUTER.toFixed(6)}`,
    `#define TEMP_EXP ${TEMPERATURE_EXPONENT.toFixed(6)}`,
    '',
  ].join('\n');
}
