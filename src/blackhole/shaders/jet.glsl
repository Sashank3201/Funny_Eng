// Relativistic jet — volumetric emission sampled along the geodesic, so jet
// light is bent by the same integration as everything else rather than being
// composited on top afterwards.
//
// PHYSICS NOTE: a Schwarzschild hole cannot launch jets. Blandford–Znajek
// extracts rotational energy through the ergosphere, which requires spin, so a
// jetted hole is a Kerr hole. Everything else in this scene is Schwarzschild;
// the jets are the one element that implies spin, kept because they are the
// most recognisable thing an accreting black hole does.
//
// Requires the physics defines and noise.glsl.

uniform float uJetBrightness;
uniform float uJetLength;

/** Emissivity of the jet at a world-space point. Deliberately analytic — this
 *  runs at every integration step, so it has to stay cheap. */
vec3 jetEmission(vec3 p) {
  float h = abs(p.y);
  float launch = 2.2 * RS;
  if (h < launch || h > uJetLength) return vec3(0.0);

  // Narrow cone opening slowly with height.
  float coneR = 0.30 * RS + h * 0.055;
  float d = length(p.xz);
  float radial = exp(-(d * d) / (coneR * coneR) * 2.4);
  if (radial < 0.003) return vec3(0.0);

  // Bright at the base, fading downstream as the flow decollimates.
  float t = (h - launch) / max(uJetLength - launch, 1e-3);
  float profile = (1.0 - smoothstep(0.0, 0.85, t)) * (0.35 + 0.65 * exp(-t * 5.0));

  // Helical structure from magnetic collimation, plus knots along the flow.
  float az = atan(p.z, p.x);
  float helix = 0.72 + 0.28 * sin(az * 2.0 + h * 1.15 * sign(p.y));
  float knots = 0.78 + 0.22 * sin(h * 2.3 - uTime * 0.55);

  // Hot and blue-white at the base, cooling to violet downstream.
  vec3 colour = mix(vec3(0.72, 0.88, 1.0), vec3(0.34, 0.20, 0.62), smoothstep(0.0, 0.7, t));

  return colour * radial * profile * helix * knots * uJetBrightness;
}
