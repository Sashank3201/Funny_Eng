// Final composite: bloom, tonemap, lens artefacts, grain, sRGB encode.

precision highp float;

uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform float uBloomIntensity;
uniform float uExposure;
uniform float uTime;
uniform float uAberration;
uniform float uGrain;
uniform float uVignette;

varying vec2 vUv;

// Narkowicz's ACES approximation — keeps the blown-out inner disk from
// clipping to flat white.
vec3 acesFilm(vec3 x) {
  const float a = 2.51;
  const float b = 0.03;
  const float c = 2.43;
  const float d = 0.59;
  const float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

float hash21(vec2 p) {
  p = fract(p * vec2(233.34, 851.73));
  p += dot(p, p + 23.45);
  return fract(p.x * p.y);
}

vec3 toSrgb(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(max(c, 1e-5), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

void main() {
  vec2 d = vUv - 0.5;
  float r2 = dot(d, d);

  // Chromatic aberration that only bites toward the frame edges.
  vec2 off = d * r2 * uAberration;
  vec3 col;
  col.r = texture2D(uScene, vUv + off).r;
  col.g = texture2D(uScene, vUv).g;
  col.b = texture2D(uScene, vUv - off).b;

  col += texture2D(uBloom, vUv).rgb * uBloomIntensity;

  col = acesFilm(col * uExposure);

  // Vignette pulls the eye to the centre of the frame.
  col *= 1.0 - uVignette * smoothstep(0.15, 0.75, r2);

  // A little grain hides banding across the large dark gradients.
  float n = hash21(vUv * 1024.0 + fract(uTime) * 91.7) - 0.5;
  col += n * uGrain;

  gl_FragColor = vec4(toSrgb(max(col, 0.0)), 1.0);
}
