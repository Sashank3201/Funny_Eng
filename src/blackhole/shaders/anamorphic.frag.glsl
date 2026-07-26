// Anamorphic streak — a wide, purely horizontal blur of the bright-pass.
//
// Anamorphic lenses squeeze the image horizontally, so out-of-focus highlights
// smear sideways and flare into a horizontal bar. Faking it costs one cheap
// pass and is the single most recognisably "shot on film" thing in the chain.

precision highp float;

uniform sampler2D uScene;
uniform vec2 uTexel;
uniform float uWidth;

varying vec2 vUv;

void main() {
  vec3 col = vec3(0.0);
  float total = 0.0;

  // 17 taps spread wide across the horizontal only.
  for (int i = -8; i <= 8; i++) {
    float fi = float(i);
    float w = exp(-fi * fi / 24.0);
    col += texture2D(uScene, vUv + vec2(fi * uTexel.x * uWidth, 0.0)).rgb * w;
    total += w;
  }

  gl_FragColor = vec4(col / total, 1.0);
}
