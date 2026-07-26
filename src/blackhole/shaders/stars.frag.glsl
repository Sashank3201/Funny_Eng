// Deep-space background: a galactic band with dust lanes, domain-warped
// nebulae, distant galaxies, and three parallax layers of stars, all dimmed by
// large-scale interstellar extinction.
//
// This pass is expensive, and it is cached — the renderer only re-runs it when
// the parallax moves or the twinkle needs a step, because none of it depends on
// the camera. The lensing pass, which does track the camera, is cheap and stays
// live.

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
  for (int i = 0; i < 4; i++) {
    v += amp * valueNoise(p);
    p *= 2.07;
    amp *= 0.5;
  }
  return v;
}

vec2 rot(vec2 p, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec2(p.x * c - p.y * s, p.x * s + p.y * c);
}

/** Blackbody-ish star colour from a 0..1 temperature draw. */
vec3 starColour(float t) {
  vec3 m = vec3(1.00, 0.72, 0.52); // M — cool red dwarf
  vec3 k = vec3(1.00, 0.87, 0.74);
  vec3 g = vec3(1.00, 0.97, 0.93); // G — sun-like
  vec3 a = vec3(0.86, 0.92, 1.00);
  vec3 o = vec3(0.68, 0.80, 1.00); // O — hot blue giant

  vec3 c = mix(m, k, smoothstep(0.00, 0.30, t));
  c = mix(c, g, smoothstep(0.28, 0.55, t));
  c = mix(c, a, smoothstep(0.52, 0.80, t));
  c = mix(c, o, smoothstep(0.78, 1.00, t));
  return c;
}

/**
 * One grid layer of stars. Each cell holds at most one star at a random offset.
 * `spikes` adds a diffraction cross to the brightest few, which is the detail
 * that makes a starfield read as photographed rather than generated.
 */
vec3 starLayer(vec2 uv, float cells, float density, float brightness, float seed, float spikes) {
  vec2 gv = uv * cells;
  vec2 id = floor(gv);
  vec2 f = fract(gv) - 0.5;

  vec3 acc = vec3(0.0);
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 off = vec2(float(x), float(y));
      vec2 cid = id + off;
      vec2 rnd = hash22(cid + seed);
      if (rnd.x > density) continue;

      vec2 sp = off + (rnd - 0.5) * 0.8 - f;
      float d = length(sp);

      // Steep magnitude distribution: mostly faint pinpricks, a few that carry
      // real weight. A flat distribution reads as noise.
      float mag = hash21(cid * 1.7 + seed);
      float m3 = mag * mag * mag;
      float size = mix(0.010, 0.060, m3);
      float glow = pow(clamp(size / max(d, 1e-4), 0.0, 1.0), 2.4);

      // Slow, per-star twinkle.
      float tw = 0.78 + 0.22 * sin(uTime * (0.35 + rnd.y * 1.1) + rnd.x * 30.0);

      vec3 tint = starColour(hash21(cid + 7.3));

      float v = glow;

      if (spikes > 0.0 && m3 > 0.45) {
        // Four-point diffraction cross, scaled by how bright the star is.
        float sx = exp(-abs(sp.x) * 190.0) * exp(-abs(sp.y) * 9.0);
        float sy = exp(-abs(sp.y) * 190.0) * exp(-abs(sp.x) * 9.0);
        v += (sx + sy) * m3 * spikes * 0.6;
      }

      acc += tint * v * brightness * tw;
    }
  }
  return acc;
}

/** A handful of distant galaxies — elongated, faintly textured smudges. */
vec3 galaxies(vec2 uv) {
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    vec2 c = (hash22(vec2(fi * 13.7, 4.1)) - 0.5) * vec2(1.7, 1.0);
    float ang = hash21(vec2(fi, 9.3)) * 3.14159;
    float scale = mix(0.030, 0.075, hash21(vec2(fi, 21.7)));

    vec2 p = rot(uv - c, ang) / scale;
    // Flattened disc.
    p.y *= 2.6;
    float r = length(p);
    float core = exp(-r * r * 2.2);
    float halo = exp(-r * 1.5) * 0.35;

    // Faint spiral texture.
    float tex = 0.6 + 0.4 * fbm(p * 1.8 + fi * 5.0);

    vec3 tint = mix(vec3(1.0, 0.88, 0.72), vec3(0.78, 0.86, 1.0), hash21(vec2(fi, 33.1)));
    acc += tint * (core + halo) * tex * 0.06;
  }
  return acc;
}

void main() {
  // Aspect-correct so stars stay round on any viewport.
  float aspect = uResolution.x / max(uResolution.y, 1.0);
  vec2 uv = vec2((vUv.x - 0.5) * aspect, vUv.y - 0.5);

  // ---- Galactic band ------------------------------------------------------
  // A tilted lane of unresolved starlight, split by dark dust clouds. Running
  // it diagonally gives the frame a compositional axis the disk can cut across.
  vec2 bp = rot(uv + uParallax * 0.12, -0.46);
  float bandMask = exp(-pow(bp.y / 0.26, 2.0));

  vec2 bw = vec2(fbm(bp * 1.4 + 2.0), fbm(bp * 1.4 + 7.3));
  float bandTex = fbm(bp * vec2(1.1, 3.2) + bw * 0.7);

  // Dust lanes: dark filaments cutting along the band.
  float dust = fbm(bp * vec2(1.8, 5.5) + 11.0);
  dust = smoothstep(0.42, 0.66, dust);

  float band = bandMask * bandTex * (1.0 - dust * 0.88);

  // Unresolved star haze concentrated in the band.
  float haze = pow(fbm((uv + uParallax * 0.2) * 42.0), 4.0) * 5.0;
  band += bandMask * haze * (1.0 - dust * 0.7) * 0.5;

  vec3 bandCol = mix(vec3(0.42, 0.44, 0.52), vec3(0.58, 0.50, 0.42), bandTex);

  // ---- Nebulae ------------------------------------------------------------
  // Two levels of domain warping. Plain fbm reads as fog; warped fbm reads as
  // structure — filaments, cavities, edges.
  vec2 np = uv + uParallax * 0.16;
  vec2 q = vec2(fbm(np * 0.9), fbm(np * 0.9 + 3.7));
  vec2 rr = vec2(fbm(np * 1.3 + 3.4 * q + 1.2), fbm(np * 1.3 + 3.4 * q + 8.3));
  float neb = fbm(np * 1.7 + 2.6 * rr);

  // Region mask, so the nebulae live somewhere rather than everywhere.
  float nebMask = smoothstep(0.40, 0.78, fbm(np * 0.55 + 20.0));
  neb = pow(max(neb - 0.34, 0.0), 1.8) * 1.7 * nebMask;

  vec3 nebCol = mix(vec3(0.10, 0.09, 0.30), vec3(0.42, 0.13, 0.26), clamp(rr.x * 1.5, 0.0, 1.0));
  nebCol = mix(nebCol, vec3(0.36, 0.20, 0.10), clamp(q.y * 1.2, 0.0, 1.0) * 0.55);

  // ---- Stars --------------------------------------------------------------
  vec3 stars = vec3(0.0);
  stars += starLayer(uv + uParallax * 0.30, 9.0, 0.22, 0.95, 0.0, 1.0);
  stars += starLayer(uv + uParallax * 0.60, 17.0, 0.16, 0.44, 11.0, 0.0);
  stars += starLayer(uv + uParallax * 1.00, 30.0, 0.11, 0.20, 23.0, 0.0);

  // The band is thick with stars; boost density there rather than everywhere.
  stars *= 1.0 + bandMask * 0.5;

  // ---- Extinction ---------------------------------------------------------
  // Large-scale dust dimming everything behind it. This, more than anything
  // else here, is what gives the field depth.
  float ext = mix(0.30, 1.0, smoothstep(0.28, 0.74, fbm(uv * 0.75 + 30.0)));

  vec3 col = vec3(0.0);
  col += bandCol * band * 0.15;
  col += nebCol * neb;
  col += galaxies(uv + uParallax * 0.22);
  col *= ext;
  col += stars * mix(0.55, 1.0, ext);

  // Faint cold floor so the frame is never pure black.
  col += vec3(0.006, 0.008, 0.018);

  gl_FragColor = vec4(col * uIntensity, 1.0);
}
