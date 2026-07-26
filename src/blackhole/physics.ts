/**
 * Schwarzschild black hole physics — the single source of truth.
 *
 * Everything is in geometric units where the Schwarzschild radius Rs = 1, so
 * G = c = 1 and the mass M = Rs/2 = 0.5. Working in units of Rs keeps every
 * interesting length a small readable number.
 *
 * The same constants are injected into GLSL as #defines via
 * `glslPhysicsDefines()`, so TypeScript and the shaders cannot drift apart.
 *
 * Unlike the earlier screen-space version, nothing here is a fitted constant.
 * The renderer integrates the exact null geodesic equation, so every feature —
 * shadow radius, photon ring, Einstein ring, the disk's secondary image — is a
 * consequence of these formulae rather than something drawn on top.
 */

/** Schwarzschild radius, our unit of length. Rs = 2GM/c². */
export const RS = 1.0;

/** Mass in geometric units: M = Rs/2. */
export const MASS = RS / 2;

/**
 * Photon sphere: the radius at which light itself orbits in a circle.
 * r_ph = 3M = 1.5 Rs
 */
export const PHOTON_SPHERE = 3 * MASS;

/**
 * Innermost stable circular orbit. Inside this matter cannot hold an orbit and
 * plunges through the horizon, so it is the inner edge of the accretion disk.
 * r_isco = 6M = 3 Rs
 */
export const ISCO = 6 * MASS;

/**
 * Critical impact parameter — the apparent radius of the shadow to a distant
 * observer. Light with b below this is captured.
 *
 *   b_crit = 3√3 M = (√27/2) Rs ≈ 2.598 Rs
 *
 * Note this is noticeably larger than the horizon: the hole looks bigger than
 * it is because it bends light inward. This value is *not* fed to the renderer
 * as a drawing radius — it is what the integration should independently
 * produce, which is what the physics self-test checks.
 */
export const B_CRIT = 3 * Math.sqrt(3) * MASS;

/** Outer edge of the modelled accretion disk. */
export const DISK_OUTER = 10.0 * RS;

/** Inner edge of the accretion disk — no stable orbit exists inside the ISCO. */
export const DISK_INNER = ISCO;

/** Radius past which a ray is treated as escaped to infinity. */
export const ESCAPE_RADIUS = 60.0 * RS;

/** Shakura–Sunyaev thin-disk temperature profile, T ∝ r^(−3/4). */
export const TEMPERATURE_EXPONENT = 0.75;

/**
 * The exact photon orbit equation in Schwarzschild geometry, in Binet form
 * with u = 1/r:
 *
 *   d²u/dφ² = 3Mu² − u
 *
 * This is what the renderer integrates with RK4. It is exact — there is no
 * weak-field expansion here, which is precisely why the strong-field features
 * come out right.
 */
export function geodesicAcceleration(u: number): number {
  return 3 * MASS * u * u - u;
}

/**
 * Keplerian angular velocity of a circular orbit at radius r, as seen from
 * infinity: Ω = ±√(M/r³).
 */
export function keplerianOmega(r: number): number {
  return Math.sqrt(MASS / (r * r * r));
}

/**
 * Total redshift factor g = ν_observed / ν_emitted for light emitted by matter
 * on a circular Keplerian orbit, collected by a distant observer:
 *
 *   g = √(1 − 3M/r) / (1 + Ω λ)
 *
 * where λ = L_z/E is the photon's conserved impact parameter about the spin
 * axis. This single expression carries both effects at once: gravitational
 * redshift climbing out of the well, and relativistic Doppler from orbital
 * motion. The `1 + Ωλ` term is what makes the approaching limb bright and the
 * receding limb dim.
 *
 * √(1 − 3M/r) vanishes at r = 3M — the photon sphere — which is the same fact
 * that forbids stable circular orbits inside the ISCO.
 */
export function redshiftFactor(r: number, lambda: number, prograde = true): number {
  const omega = (prograde ? 1 : -1) * keplerianOmega(r);
  const numerator = Math.sqrt(Math.max(0, 1 - (3 * MASS) / r));
  return numerator / (1 + omega * lambda);
}

/**
 * Weak-field deflection, α = 4M/b. Only valid for b ≫ b_crit — it is kept
 * because the renderer uses it as the far-field shortcut, and because the
 * physics self-test asserts the full integration converges on it out there.
 */
export function weakFieldDeflection(b: number): number {
  return (4 * MASS) / b;
}

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
    `#define B_CRIT ${B_CRIT.toFixed(6)}`,
    `#define DISK_INNER ${DISK_INNER.toFixed(6)}`,
    `#define DISK_OUTER ${DISK_OUTER.toFixed(6)}`,
    `#define ESCAPE_RADIUS ${ESCAPE_RADIUS.toFixed(6)}`,
    `#define TEMP_EXP ${TEMPERATURE_EXPONENT.toFixed(6)}`,
    '',
  ].join('\n');
}
