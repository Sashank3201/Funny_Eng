// Bloom pyramid upsample — 9-tap tent filter, additively combined with the
// larger mip already in the destination. Progressive upsampling like this is
// what gives a wide, smooth, filmic falloff instead of the ringing you get from
// blurring repeatedly at one resolution.

precision highp float;

uniform sampler2D uScene;
uniform vec2 uTexel;  // 1 / source size
uniform float uRadius;

varying vec2 vUv;

void main() {
  vec2 t = uTexel * uRadius;

  vec3 a = texture2D(uScene, vUv + vec2(-1.0, 1.0) * t).rgb;
  vec3 b = texture2D(uScene, vUv + vec2(0.0, 1.0) * t).rgb;
  vec3 c = texture2D(uScene, vUv + vec2(1.0, 1.0) * t).rgb;
  vec3 d = texture2D(uScene, vUv + vec2(-1.0, 0.0) * t).rgb;
  vec3 e = texture2D(uScene, vUv).rgb;
  vec3 f = texture2D(uScene, vUv + vec2(1.0, 0.0) * t).rgb;
  vec3 g = texture2D(uScene, vUv + vec2(-1.0, -1.0) * t).rgb;
  vec3 h = texture2D(uScene, vUv + vec2(0.0, -1.0) * t).rgb;
  vec3 i = texture2D(uScene, vUv + vec2(1.0, -1.0) * t).rgb;

  vec3 col = e * 4.0;
  col += (b + d + f + h) * 2.0;
  col += (a + c + g + i);
  col *= 1.0 / 16.0;

  gl_FragColor = vec4(col, 1.0);
}
