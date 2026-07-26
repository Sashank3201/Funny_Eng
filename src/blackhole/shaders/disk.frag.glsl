// Accretion-disk fragment shader.
// Draws each instance as a soft capsule — a line segment with rounded caps —
// tinted by its observed temperature and additively blended into the HDR
// buffer. Requires streak.glsl to be prepended.

precision highp float;

uniform float uExposure;

varying float vBright;
varying float vTemp;
varying float vFade;
varying vec2 vCorner;
varying vec2 vStreak;

// Approximate blackbody ramp, cool (deep red) to hot (blue-white). The blue end
// is what the Doppler-boosted approaching limb of the disk lands on.
vec3 blackbodyRamp(float t) {
  vec3 c0 = vec3(0.32, 0.035, 0.010); // dull ember
  vec3 c1 = vec3(1.00, 0.240, 0.045); // orange
  vec3 c2 = vec3(1.00, 0.660, 0.280); // amber
  vec3 c3 = vec3(1.00, 0.960, 0.900); // white hot
  vec3 c4 = vec3(0.66, 0.820, 1.000); // blue-white

  vec3 c = mix(c0, c1, smoothstep(0.00, 0.28, t));
  c = mix(c, c2, smoothstep(0.26, 0.55, t));
  c = mix(c, c3, smoothstep(0.52, 0.80, t));
  c = mix(c, c4, smoothstep(0.78, 1.00, t));
  return c;
}

void main() {
  float falloff = streakCoverage(vCorner, vStreak);
  if (falloff < 0.004) discard;

  vec3 col = blackbodyRamp(vTemp) * vBright * vFade * falloff * uExposure;
  gl_FragColor = vec4(col, 1.0);
}
