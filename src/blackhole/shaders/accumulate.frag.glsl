// Temporal accumulation for the disk and jets.
//
// Blending each frame into a history buffer is motion blur for free, and it is
// what turns discrete particles into continuous flowing light. Only the
// disk/jet layer goes through here — the stars and the photon ring stay crisp.

precision highp float;

uniform sampler2D uCurrent;
uniform sampler2D uHistory;
/** Blend weight for the new frame. Low = long silky trails, high = crisp. */
uniform float uBlend;

varying vec2 vUv;

void main() {
  vec3 cur = texture2D(uCurrent, vUv).rgb;
  vec3 hist = texture2D(uHistory, vUv).rgb;

  // The history is not reprojected, so a moving camera would smear the whole
  // frame. The renderer raises uBlend as the camera moves, which is what keeps
  // the trails on the orbital flow instead of on the camera path.
  gl_FragColor = vec4(mix(hist, cur, uBlend), 1.0);
}
