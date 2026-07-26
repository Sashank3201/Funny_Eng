// Bloom pyramid downsample — the 13-tap filter from Jimenez's SIGGRAPH 2014
// "Next Generation Post Processing in Call of Duty: Advanced Warfare". The
// overlapping box groups are what keep the pyramid from flickering on small
// bright features, which a naive bilinear halving cannot do.

precision highp float;

uniform sampler2D uScene;
uniform vec2 uTexel; // 1 / source size

varying vec2 vUv;

void main() {
  vec2 t = uTexel;

  vec3 a = texture2D(uScene, vUv + vec2(-2.0, 2.0) * t).rgb;
  vec3 b = texture2D(uScene, vUv + vec2(0.0, 2.0) * t).rgb;
  vec3 c = texture2D(uScene, vUv + vec2(2.0, 2.0) * t).rgb;
  vec3 d = texture2D(uScene, vUv + vec2(-2.0, 0.0) * t).rgb;
  vec3 e = texture2D(uScene, vUv).rgb;
  vec3 f = texture2D(uScene, vUv + vec2(2.0, 0.0) * t).rgb;
  vec3 g = texture2D(uScene, vUv + vec2(-2.0, -2.0) * t).rgb;
  vec3 h = texture2D(uScene, vUv + vec2(0.0, -2.0) * t).rgb;
  vec3 i = texture2D(uScene, vUv + vec2(2.0, -2.0) * t).rgb;

  vec3 j = texture2D(uScene, vUv + vec2(-1.0, 1.0) * t).rgb;
  vec3 k = texture2D(uScene, vUv + vec2(1.0, 1.0) * t).rgb;
  vec3 l = texture2D(uScene, vUv + vec2(-1.0, -1.0) * t).rgb;
  vec3 m = texture2D(uScene, vUv + vec2(1.0, -1.0) * t).rgb;

  vec3 col = e * 0.125;
  col += (a + c + g + i) * 0.03125;
  col += (b + d + f + h) * 0.0625;
  col += (j + k + l + m) * 0.125;

  gl_FragColor = vec4(col, 1.0);
}
