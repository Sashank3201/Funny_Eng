// Relativistic jet fragment shader. Same capsule coverage as the disk, but on a
// hot synchrotron ramp — cyan-white at the base, cooling to violet downstream.
// Requires streak.glsl to be prepended.

precision highp float;

uniform float uExposure;

varying float vBright;
varying float vTemp;
varying float vFade;
varying vec2 vCorner;
varying vec2 vStreak;

vec3 jetRamp(float t) {
  vec3 cool = vec3(0.34, 0.16, 0.62); // violet, downstream
  vec3 mid = vec3(0.30, 0.60, 1.00);  // cyan-blue
  vec3 hot = vec3(0.88, 0.96, 1.00);  // white, at the base knot

  vec3 c = mix(cool, mid, smoothstep(0.0, 0.6, t));
  c = mix(c, hot, smoothstep(0.6, 1.0, t));
  return c;
}

void main() {
  float falloff = streakCoverage(vCorner, vStreak);
  if (falloff < 0.004) discard;

  vec3 col = jetRamp(vTemp) * vBright * vFade * falloff * uExposure;
  gl_FragColor = vec4(col, 1.0);
}
