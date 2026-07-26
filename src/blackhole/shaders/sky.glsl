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
        v += (sx + sy) * m3 * spikes * 0.75;
      }
      acc += tint * v * bright;
    }
  }
  return acc;
}

/**
 * Three bright stars, placed rather than hashed.
 *
 * The hashed layers are lensed too — every ray is — but the stars in them are
 * sub-pixel pinpricks, so their arcs are thin and dark enough that the bending
 * does not read. These three are put where the bending is strongest and made
 * large and bright enough to survive it.
 *
 * They sit within a few degrees of the direction the hero pose looks *through*
 * the hole, so their light reaches the camera the long way round — the shadow's
 * angular radius from 33 Rs is about 4.4°, and a source this close to the axis
 * has its image pulled into an arc hugging the photon ring, with a second,
 * fainter image on the opposite side. None of that is drawn: it falls out of the
 * integrator sampling this function with the ray's outgoing direction.
 *
 * The offsets are 1.5°, 3.5° and 7° at different position angles, so the three
 * behave differently — the closest sweeps nearly all the way round, the furthest
 * is a short smear. The camera's idle drift is a couple of degrees, the same
 * order as the offsets, so the arcs breathe rather than sit still.
 *
 * They are far smaller than they look. `R` is about 0.08° — a fifth the width of
 * the pinpricks in the hashed layers — because the magnification near the ring
 * is enormous: at 0.57° these rendered as 80 px bands that swamped the frame.
 * Arc *length* is set by the geometry and does not shrink with the source, so
 * the size knob controls thickness only.
 */
/** Angular radius of a beacon, as a chord between unit vectors. About 0.08°. */
const float BEACON_R = 0.0014;

/** One beacon. `dir` must be normalised. */
vec3 beacon(vec3 d, vec3 dir, float kelvin, float gain) {
  // Chord length, which for unit vectors is the angular separation to within a
  // part in 10^5 at these angles — and unlike acos it stays well-conditioned as
  // the separation goes to zero, which is exactly where these live.
  float s = length(d - dir);
  float core = 1.0 - smoothstep(BEACON_R * 0.5, BEACON_R, s);
  float halo = exp(-s / (BEACON_R * 2.4)) * 0.30;
  return mix(vec3(1.0), blackbodyRGB(kelvin), 0.6) * (core + halo) * gain;
}

/*
 * Written out rather than looped over an array on purpose. GLSL ES 1.00 does not
 * guarantee dynamic indexing of a local array, and indexing one by the loop
 * counter rendered correctly for several frames and then corrupted a whole
 * rectangular region of the output. Three calls cost nothing and the behaviour
 * is defined everywhere, which matters more here than usual — this ships to
 * whatever driver the viewer's phone happens to have.
 */
vec3 beaconStars(vec3 d) {
  vec3 acc = beacon(d, normalize(vec3( 0.018510, -0.118217, -0.992815)),  7600.0, 2.8);
  acc += beacon(d, normalize(vec3(-0.060121, -0.089099, -0.994207)),  4900.0, 2.4);
  acc += beacon(d, normalize(vec3( 0.078336, -0.006198, -0.996908)), 10500.0, 2.6);
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
  col += starLayer(uv, faceId, 11.0, 0.24, 1.45, 1.0);
  col += starLayer(uv, faceId + 11.0, 21.0, 0.18, 0.66, 0.0);
  col += starLayer(uv, faceId + 23.0, 38.0, 0.13, 0.30, 0.0);

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
  col += bandCol * band * bandTex * 0.17;

  // Unresolved star haze concentrated in the band.
  col += vec3(0.7, 0.74, 0.85) * band * pow(fbm3(d * 46.0, 2), 4.0) * 2.2;

  // Nebulae, region-masked so they live somewhere rather than everywhere.
  float nebMask = smoothstep(0.42, 0.80, fbm3(d * 1.5 + 30.0, 3));
  float neb = pow(max(clouds - 0.36, 0.0), 1.7) * 1.15 * nebMask;
  vec3 nebCol = mix(vec3(0.09, 0.08, 0.26), vec3(0.38, 0.12, 0.24), clamp(q.x * 1.6, 0.0, 1.0));
  nebCol = mix(nebCol, vec3(0.32, 0.18, 0.09), clamp(q.y * 1.3, 0.0, 1.0) * 0.5);
  col += nebCol * neb;

  // Large-scale extinction, which is what gives the field depth.
  col *= mix(0.35, 1.0, smoothstep(0.25, 0.75, fbm3(d * 1.1 + 60.0, 3)));

  // Added after extinction. These are meant to be the brightest things in the
  // sky at a known strength; letting a dust patch dim one by two thirds would
  // decide whether its arc is visible at all.
  col += beaconStars(d);

  // Faint cold floor so the frame is never pure black.
  col += vec3(0.005, 0.007, 0.016);

  return col;
}
