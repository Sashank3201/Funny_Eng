// Accretion-disk emission at a single equatorial crossing.
// Requires the physics defines and noise.glsl.

uniform float uDiskTemp;       // peak effective temperature, Kelvin
uniform float uDiskBrightness;
uniform float uDiskSpin;       // +1 prograde about +Y, -1 retrograde
uniform float uTime;

/**
 * Shakura–Sunyaev flux profile with a zero-torque inner boundary:
 *
 *   F(r) ∝ r⁻³ (1 − √(r_in/r))
 *
 * The taper is what makes the disk fade to nothing at the ISCO instead of
 * ending on a hard ring — matter there is plunging, not radiating.
 * Normalised so the profile peaks at 1 (which occurs at r = (49/36) r_in).
 */
float diskFlux(float r) {
  float x = DISK_INNER / r;
  float f = x * x * x * (1.0 - sqrt(x));
  return max(f, 0.0) / 0.056712; // peak of x³(1−√x) on (0,1]
}

/**
 * Radiance leaving the disk at radius `r`, as collected by a distant observer.
 *
 * `lambda` is the photon's conserved L_z/E. The redshift factor
 *
 *   g = √(1 − 3M/r) / (1 + Ω λ)
 *
 * carries gravitational redshift and relativistic Doppler at once, so the
 * bright approaching limb and dim receding limb are consequences of the
 * geometry rather than something painted in. Observed intensity goes as g⁴
 * because I_ν/ν³ is a Lorentz invariant, and the observed colour is a
 * blackbody at g·T.
 */
vec3 diskEmission(vec3 pos, float r, float lambda) {
  float flux = diskFlux(r);
  if (flux <= 0.0) return vec3(0.0);

  float omega = uDiskSpin * sqrt(MASS / (r * r * r));
  float g = sqrt(max(0.0, 1.0 - 3.0 * MASS / r)) / max(1.0 + omega * lambda, 0.05);

  // Turbulence sheared by the differential rotation: sampling in a frame that
  // co-rotates at Ω(r) means the pattern winds up into spiral filaments on its
  // own, because the inner disk laps the outer.
  float ang = -omega * uTime * 0.55;
  float ca = cos(ang), sa = sin(ang);
  vec2 q = vec2(pos.x * ca - pos.z * sa, pos.x * sa + pos.z * ca);

  // Radially stretched sampling: real disk structure is sheared into long
  // arcs by the differential rotation, not isotropic blobs.
  float turb = fbm2(q * vec2(1.6, 1.6) * 0.55, 4) * 0.55
             + fbm2(q * 2.4 + 11.0, 4) * 0.30
             + fbm2(q * 6.5 + 31.0, 3) * 0.15;
  turb = mix(0.35, 1.75, smoothstep(0.25, 0.75, turb));

  // Fade the outer edge so the disk dissolves into space.
  float outerFade = 1.0 - smoothstep(DISK_OUTER * 0.72, DISK_OUTER, r);

  float tLocal = uDiskTemp * pow(flux, 0.25);
  vec3 colour = blackbodyRGB(tLocal * g);

  float g4 = g * g * g * g;
  return colour * flux * g4 * turb * outerFade * uDiskBrightness;
}
