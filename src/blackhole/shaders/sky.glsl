// Deep-space background, sampled by 3-D direction.
//
// Direction-sampled rather than screen-space, because the geodesic integrator
// hands us the ray's *asymptotic* direction after it has been bent. Sampling a
// real celestial sphere is what makes the lensing read as lensing: stars smear
// into arcs and duplicate around the shadow because the rays genuinely arrive
// from those directions.
//
// Requires noise.glsl.

/** Project a direction onto its dominant cube face — even star density, no
 *  polar pinching, and no seam artefacts inside a face. */
vec3 cubeFace(vec3 d, out vec2 uv) {
  vec3 a = abs(d);
  if (a.x >= a.y && a.x >= a.z) {
    uv = vec2(d.z, d.y) / a.x;
    return vec3(sign(d.x), 0.0, 0.0);
  } else if (a.y >= a.z) {
    uv = vec2(d.x, d.z) / a.y;
    return vec3(0.0, sign(d.y), 0.0);
  }
  uv = vec2(d.x, d.y) / a.z;
  return vec3(0.0, 0.0, sign(d.z));
}

/** One grid layer of stars on the cube face. */
vec3 starLayer(vec2 uv, float faceId, float cells, float density, float bright, float spikes) {
  vec2 gv = uv * cells;
  vec2 id = floor(gv);
  vec2 f = fract(gv) - 0.5;

  vec3 acc = vec3(0.0);
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 off = vec2(float(x), float(y));
      vec2 cid = id + off + faceId * 37.0;
      vec2 rnd = hash22(cid);
      if (rnd.x > density) continue;

      vec2 sp = off + (rnd - 0.5) * 0.85 - f;
      float d = length(sp);

      // Steep magnitude distribution — mostly faint pinpricks, a few that
      // carry real weight. A flat distribution reads as noise.
      float mag = hash21(cid * 1.7 + 3.1);
      float m3 = mag * mag * mag;
      float glow = pow(clamp(mix(0.004, 0.026, m3) / max(d, 1e-4), 0.0, 1.0), 2.5);

      // Real stellar colours, kept close to white so the lensing does not
      // scatter them into confetti.
      vec3 tint = blackbodyRGB(mix(3200.0, 11000.0, hash21(cid + 7.3)));
      tint = mix(vec3(1.0), tint, 0.55);

      float v = glow;
      if (spikes > 0.0 && m3 > 0.5) {
        float sx = exp(-abs(sp.x) * 170.0) * exp(-abs(sp.y) * 8.0);
        float sy = exp(-abs(sp.y) * 170.0) * exp(-abs(sp.x) * 8.0);
        v += (sx + sy) * m3 * spikes * 0.55;
      }
      acc += tint * v * bright;
    }
  }
  return acc;
}

/**
 * Sky radiance arriving from direction `d`.
 * Galactic band with dust lanes, domain-warped nebulae, three star layers.
 */
vec3 skyRadiance(vec3 d) {
  d = normalize(d);

  vec2 uv;
  vec3 face = cubeFace(d, uv);
  float faceId = face.x * 1.0 + face.y * 2.0 + face.z * 3.0;

  vec3 col = vec3(0.0);
  col += starLayer(uv, faceId, 11.0, 0.22, 0.95, 1.0);
  col += starLayer(uv, faceId + 11.0, 21.0, 0.16, 0.42, 0.0);
  col += starLayer(uv, faceId + 23.0, 38.0, 0.11, 0.18, 0.0);

  // Galactic band — a great circle tilted off the disk plane so it reads as an
  // independent structure rather than an echo of the accretion disk.
  vec3 galacticPole = normalize(vec3(0.42, 0.66, -0.62));
  float lat = dot(d, galacticPole);
  float band = exp(-lat * lat * 26.0);

  // Two levels of domain warping. Plain fbm reads as fog; warped fbm reads as
  // structure — filaments, cavities, edges.
  vec3 q = vec3(fbm3(d * 2.6, 3), fbm3(d * 2.6 + 5.2, 3), fbm3(d * 2.6 + 11.7, 3));
  float clouds = fbm3(d * 3.4 + 2.2 * q, 4);

  // Dark dust lanes cutting along the band.
  float dust = smoothstep(0.42, 0.68, fbm3(d * 6.0 + 17.0, 3));
  float bandTex = clouds * (1.0 - dust * 0.85);

  vec3 bandCol = mix(vec3(0.30, 0.33, 0.42), vec3(0.46, 0.38, 0.31), clouds);
  col += bandCol * band * bandTex * 0.34;

  // Unresolved star haze concentrated in the band.
  col += vec3(0.7, 0.74, 0.85) * band * pow(fbm3(d * 46.0, 2), 4.0) * 1.6;

  // Nebulae, region-masked so they live somewhere rather than everywhere.
  float nebMask = smoothstep(0.42, 0.80, fbm3(d * 1.5 + 30.0, 3));
  float neb = pow(max(clouds - 0.36, 0.0), 1.7) * 2.4 * nebMask;
  vec3 nebCol = mix(vec3(0.09, 0.08, 0.26), vec3(0.38, 0.12, 0.24), clamp(q.x * 1.6, 0.0, 1.0));
  nebCol = mix(nebCol, vec3(0.32, 0.18, 0.09), clamp(q.y * 1.3, 0.0, 1.0) * 0.5);
  col += nebCol * neb;

  // Large-scale extinction, which is what gives the field depth.
  col *= mix(0.35, 1.0, smoothstep(0.25, 0.75, fbm3(d * 1.1 + 60.0, 3)));

  // Faint cold floor so the frame is never pure black.
  col += vec3(0.005, 0.007, 0.016);

  return col;
}
