// Accretion disk — a volume with finite thickness, sampled along the geodesic.
//
// This used to be a mathematical plane: the march tested for a single crossing
// of y = 0 and shaded it. That is why edge-on views read as a blade of light
// rather than a body of gas. Now the disk has a scale height, the march
// integrates emission through it, and it absorbs its own light — so the near
// edge occludes the far edge, and the lensed secondary image is partly
// extinguished on its way back through.
//
// Requires the physics defines and noise.glsl.

uniform float uDiskTemp;       // temperature at the flux peak, Kelvin
uniform float uDiskBrightness;
uniform float uDiskOpacity;    // absorption coefficient κ
uniform float uDiskSpin;       // +1 prograde about +Y, −1 retrograde
uniform float uDiskHR;         // scale height as a fraction of radius, H/R
uniform float uTime;

/**
 * Page & Thorne (1974) relativistic thin-disk flux, Schwarzschild limit,
 * normalised to peak at 1.
 *
 * The bracket vanishes exactly at the ISCO — the zero-torque inner boundary,
 * where matter is plunging rather than radiating. Note this peaks at 9.55 M,
 * noticeably further out than the Newtonian Shakura–Sunyaev form that used to
 * be here, and falls off more slowly.
 */
float diskFlux(float r) {
  float rM = r / MASS;
  if (rM <= 6.0) return 0.0;

  float x = sqrt(rM);
  const float s3 = 1.7320508;
  const float s6 = 2.4494897;
  float bracket = x - s6 + (s3 * 0.5) * log(((x + s3) * (s6 - s3)) / ((x - s3) * (s6 + s3)));

  float f = (1.0 / (rM * rM * rM)) * (1.0 / (1.0 - 3.0 / rM)) * (1.0 / x) * bracket;
  return max(f, 0.0) / PT_FLUX_PEAK;
}

/** Scale height at cylindrical radius rc. */
float diskScaleHeight(float rc) {
  return uDiskHR * rc;
}

/**
 * Gas density at a world-space point, 0 outside the disk.
 *
 * Vertical structure is Gaussian in z/H, which is the hydrostatic profile for
 * an isothermal thin disk. Turbulence is sampled in a frame co-rotating at
 * Ω(rc), so the pattern winds itself into spiral filaments — the inner disk
 * laps the outer, and the shear does the work.
 */
float diskDensity(vec3 p, out float rc) {
  rc = length(p.xz);
  if (rc < DISK_INNER || rc > DISK_OUTER) return 0.0;

  float H = diskScaleHeight(rc);
  float z = p.y / H;
  if (abs(z) > 3.0) return 0.0;

  float vertical = exp(-z * z * 1.35);

  // Radial envelope follows the emissivity, so there is no gas where there is
  // no light, and the outer edge dissolves instead of ending on a rim.
  float radial = diskFlux(rc);
  radial *= 1.0 - smoothstep(DISK_OUTER * 0.72, DISK_OUTER, rc);
  if (radial <= 0.0) return 0.0;

  float omega = uDiskSpin * sqrt(MASS / (rc * rc * rc));
  float ang = -omega * uTime * 0.55;
  float ca = cos(ang), sa = sin(ang);
  vec2 q = vec2(p.x * ca - p.z * sa, p.x * sa + p.z * ca);

  // 3-D, not 2-D. A purely radial-azimuthal field gives every sample in a
  // vertical column the same value, so integrating along the ray just
  // multiplies by path length and averages the structure away to a smooth
  // glow. Varying with height is what lets filaments survive the integral.
  vec3 qq = vec3(q.x, p.y * 4.0, q.y);
  float turb = fbm3(qq * 0.75, 3) * 0.62 + fbm3(qq * 2.3 + 11.0, 2) * 0.38;
  turb = mix(0.12, 1.95, smoothstep(0.30, 0.72, turb));

  return vertical * radial * turb;
}

/**
 * Emitted radiance per unit length at a point of the disk, as collected by a
 * distant observer.
 *
 * `lambda` is the photon's conserved L_z/E, fixed for the whole ray. The
 * redshift factor
 *
 *   g = √(1 − 3M/r) / (1 + Ω λ)
 *
 * carries gravitational redshift and relativistic Doppler at once, so the
 * bright approaching limb and dim receding limb are consequences of the
 * geometry rather than something painted in. Observed intensity goes as g⁴
 * because I_ν/ν³ is a Lorentz invariant, and the observed colour is a
 * blackbody at g·T.
 *
 * Orbital velocity is taken as Keplerian at the cylindrical radius, which is
 * the standard thin-disk approximation — the gas a scale height above the
 * midplane is treated as co-rotating with it.
 */
vec3 diskEmission(vec3 p, float rc, float density, float lambda) {
  float omega = uDiskSpin * sqrt(MASS / (rc * rc * rc));
  float g = sqrt(max(0.0, 1.0 - 3.0 * MASS / rc)) / max(1.0 + omega * lambda, 0.05);

  float tLocal = uDiskTemp * pow(diskFlux(rc), 0.25);
  vec3 colour = blackbodyRGB(tLocal * g);

  float g4 = g * g * g * g;
  return colour * g4 * density * uDiskBrightness;
}
