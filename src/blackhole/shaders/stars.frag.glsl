// Procedural background starfield: three parallax layers of point stars over a
// very faint nebula. Cheaper and sharper than a texture, and it resolves at any
// display density.

precision highp float;

uniform vec2 uResolution;
uniform float uTime;
uniform vec2 uParallax;
uniform float uIntensity;

varying vec2 vUv;

float hash21(vec2 p) {
  p = fract(p * vec2(233.34, 851.73));
  p += dot(p, p + 23.45);
  return fract(p.x * p.y);
}

vec2 hash22(vec2 p) {
  float n = hash21(p);
  return vec2(n, hash21(p + n));
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 w = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, w.x), mix(c, d, w.x), w.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 5; i++) {
    v += amp * valueNoise(p);
    p *= 2.03;
    amp *= 0.5;
  }
  return v;
}

// One grid layer of stars. Each cell holds at most one star at a random offset.
vec3 starLayer(vec2 uv, float cells, float density, float brightness, float seed) {
  vec2 gv = uv * cells;
  vec2 id = floor(gv);
  vec2 f = fract(gv) - 0.5;

  vec3 acc = vec3(0.0);
  // Sample the 3x3 neighbourhood so stars can bleed across cell borders.
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 off = vec2(float(x), float(y));
      vec2 cid = id + off;
      vec2 rnd = hash22(cid + seed);
      if (rnd.x > density) continue;

      vec2 sp = off + (rnd - 0.5) * 0.8 - f;
      float d = length(sp);

      // A steep magnitude distribution: mostly faint pinpricks, a few that
      // carry real weight. A flat distribution reads as noise.
      float mag = hash21(cid * 1.7 + seed);
      float size = mix(0.010, 0.055, pow(mag, 3.0));
      float glow = size / max(d, 1e-4);
      glow = pow(clamp(glow, 0.0, 1.0), 2.4);

      // Slow, per-star twinkle.
      float tw = 0.75 + 0.25 * sin(uTime * (0.4 + rnd.y * 1.4) + rnd.x * 30.0);

      // Cooler and warmer stars, but kept close to white — the lensing pass
      // resamples this field hard, and saturated tints turn into confetti.
      vec3 tint = mix(vec3(0.78, 0.86, 1.0), vec3(1.0, 0.90, 0.78), hash21(cid + 7.3));
      tint = mix(vec3(1.0), tint, 0.35);

      acc += tint * glow * brightness * tw;
    }
  }
  return acc;
}

void main() {
  // Aspect-correct so stars stay round on any viewport.
  float aspect = uResolution.x / max(uResolution.y, 1.0);
  vec2 uv = vec2((vUv.x - 0.5) * aspect, vUv.y - 0.5);

  vec3 col = vec3(0.0);

  // Three depth layers, each shifted a different amount by the pointer.
  // Sparse on purpose: a dense field competes with the disk for attention and
  // smears into grain once the lensing pass gets hold of it.
  col += starLayer(uv + uParallax * 0.30, 9.0, 0.20, 0.85, 0.0);
  col += starLayer(uv + uParallax * 0.60, 17.0, 0.14, 0.42, 11.0);
  col += starLayer(uv + uParallax * 1.00, 30.0, 0.10, 0.20, 23.0);

  // Faint interstellar haze so the background is never flat black.
  float neb = fbm(uv * 2.2 + uParallax * 0.2 + 4.0);
  neb = pow(max(neb - 0.42, 0.0), 2.0) * 1.6;
  vec3 nebCol = mix(vec3(0.05, 0.06, 0.16), vec3(0.16, 0.07, 0.20), fbm(uv * 1.3 - 2.0));
  col += nebCol * neb;

  gl_FragColor = vec4(col * uIntensity, 1.0);
}
