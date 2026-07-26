// Shared gravitational-lensing helper for anything drawn in the hole's frame.
// Included by both the disk and the jets.

uniform float uAspect;
uniform float uLensStrength; // deflection coefficient k, where α(b) = k/b
uniform float uShadowNdc;    // shadow radius in aspect-corrected NDC
uniform float uWarp;         // 0..1 master for the lensing arc

/**
 * Apply the hole's lensing to a point already in clip space.
 *
 * Where does a source at impact parameter b appear? Solving the lens equation
 * b_img − α(b_img) = b with α = k/b_img gives b_img = ½(b + √(b² + 4k)).
 * Solving it this way rather than adding α(b) directly is what keeps the result
 * finite: a source sitting exactly behind the hole maps to √k — a ring —
 * instead of being flung to infinity.
 *
 * `behind` blends the effect in for material further from the camera than the
 * hole, which is the only material whose light has to bend around it.
 */
vec4 lensClip(vec4 clip, vec4 holeClip, float behind) {
  if (clip.w <= 0.0 || holeClip.w <= 0.0 || behind <= 0.0) return clip;

  vec2 pN = clip.xy / clip.w;
  vec2 hN = holeClip.xy / holeClip.w;
  vec2 d = (pN - hN) * vec2(uAspect, 1.0);
  float b = max(length(d), 1e-4);
  vec2 dir = d / b;

  float bOut = 0.5 * (b + sqrt(b * b + 4.0 * uLensStrength));
  bOut = max(bOut, uShadowNdc * 1.02);

  vec2 nOut = hN + (dir * mix(b, bOut, behind)) / vec2(uAspect, 1.0);
  return vec4(nOut * clip.w, clip.z, clip.w);
}

/** How much of the lensing arc applies to a point at view-space depth `viewZ`. */
float lensBehind(float holeViewZ, float viewZ) {
  return smoothstep(0.0, 2.0 * RS, holeViewZ - viewZ) * uWarp;
}

/**
 * 0 where a point is hidden by the shadow, 1 where it is visible.
 *
 * The lensing warp already pushes material behind the hole out past the shadow
 * edge, so in principle nothing lands inside it. This is the safety net for the
 * cases where it does not — chiefly the jets, which launch close enough to the
 * axis that their base projects inside the shadow. Material in *front* of the
 * hole is always visible, shadow or not.
 */
float shadowOcclusion(vec4 clip, vec4 holeClip, float behind) {
  if (behind < 0.35 || clip.w <= 0.0 || holeClip.w <= 0.0) return 1.0;
  vec2 d = (clip.xy / clip.w - holeClip.xy / holeClip.w) * vec2(uAspect, 1.0);
  return smoothstep(uShadowNdc * 0.94, uShadowNdc * 1.03, length(d));
}
