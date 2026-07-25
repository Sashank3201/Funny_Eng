// Gravitational lensing pass.
//
// Resamples the background starfield through the hole's deflection field, cuts
// the shadow out of it, and lays the photon ring on top.
//
// A ray we observe at apparent impact parameter b originated at b − α(b) with
// α = 2Rs/b, so shading a pixel means sampling the background *closer* to the
// centre than the pixel sits. Close to the shadow α exceeds b and the sampled
// coordinate passes through zero — taking its absolute value folds it back out
// and reproduces the secondary image, which is what makes the Einstein ring.

precision highp float;

uniform sampler2D uScene;
uniform vec2 uCenter;      // hole centre, in uv
uniform float uAspect;
uniform float uShadow;     // shadow radius, in aspect-corrected uv
uniform float uLensK;      // deflection coefficient, in aspect-corrected uv
uniform float uRing;       // photon-ring intensity
uniform float uIntro;

varying vec2 vUv;

vec2 warp(vec2 p, float b, float k) {
  float alpha = k / max(b, 1e-3);
  float bSrc = abs(b - alpha);
  return normalize(p) * bSrc;
}

vec3 sampleWarped(vec2 p, float b, float k) {
  vec2 q = warp(p, b, k);
  vec2 uv = uCenter + vec2(q.x / uAspect, q.y);
  // Mirror out-of-range samples instead of clamping, so the lensed field keeps
  // its texture right up to the frame edge.
  uv = abs(mod(uv, 2.0) - 1.0);
  return texture2D(uScene, uv).rgb;
}

void main() {
  vec2 p = vec2((vUv.x - uCenter.x) * uAspect, vUv.y - uCenter.y);
  float b = length(p);

  vec3 col;
  if (b < 1e-4) {
    col = vec3(0.0);
  } else {
    // A whisper of per-channel spread in the deflection. Lensing is achromatic
    // in reality; this only has to hint at the curvature. Anything larger and
    // the point-like stars separate into red/green/blue triplets.
    float r = sampleWarped(p, b, uLensK * 0.996).r;
    float g = sampleWarped(p, b, uLensK).g;
    float bl = sampleWarped(p, b, uLensK * 1.004).b;
    col = vec3(r, g, bl);

    // Lensing conserves surface brightness but concentrates flux; brighten the
    // strongly-deflected annulus so the arcs read.
    float amp = 1.0 + 1.8 * exp(-pow((b - uShadow * 1.25) / (uShadow * 0.45), 2.0));
    col *= amp;
  }

  // The shadow: everything inside the capture radius is gone.
  float shadow = smoothstep(uShadow * 0.985, uShadow * 1.02, b);
  col *= shadow;

  // Photon ring — light that orbited the hole before escaping, piled up in a
  // thin annulus just outside the shadow.
  float ringT = (b - uShadow * 1.035) / (uShadow * 0.022);
  float ring = exp(-ringT * ringT);
  float ringOuter = exp(-pow((b - uShadow * 1.10) / (uShadow * 0.22), 2.0)) * 0.16;
  vec3 ringCol = vec3(1.00, 0.86, 0.62);
  col += ringCol * (ring * 1.35 + ringOuter) * uRing * shadow;

  gl_FragColor = vec4(col * uIntro, 1.0);
}
