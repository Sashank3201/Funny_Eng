// Separable 9-tap Gaussian, run once horizontally and once vertically per
// bloom iteration.

precision highp float;

uniform sampler2D uScene;
uniform vec2 uTexel;      // 1 / render-target size
uniform vec2 uDirection;  // (1,0) or (0,1)

varying vec2 vUv;

void main() {
  // Linear-sampling offsets: 9 taps for the cost of 5 fetches.
  const float o1 = 1.3846153846;
  const float o2 = 3.2307692308;
  const float w0 = 0.2270270270;
  const float w1 = 0.3162162162;
  const float w2 = 0.0702702703;

  vec2 step1 = uTexel * uDirection * o1;
  vec2 step2 = uTexel * uDirection * o2;

  vec3 c = texture2D(uScene, vUv).rgb * w0;
  c += texture2D(uScene, vUv + step1).rgb * w1;
  c += texture2D(uScene, vUv - step1).rgb * w1;
  c += texture2D(uScene, vUv + step2).rgb * w2;
  c += texture2D(uScene, vUv - step2).rgb * w2;

  gl_FragColor = vec4(c, 1.0);
}
