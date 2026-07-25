// Bloom bright-pass with a soft knee, so the glow ramps in rather than
// switching on at a hard threshold.

precision highp float;

uniform sampler2D uScene;
uniform float uThreshold;
uniform float uKnee;

varying vec2 vUv;

void main() {
  vec3 c = texture2D(uScene, vUv).rgb;
  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));

  float knee = max(uKnee, 1e-4);
  float soft = clamp(lum - uThreshold + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee);
  float contrib = max(soft, lum - uThreshold) / max(lum, 1e-4);

  gl_FragColor = vec4(c * contrib, 1.0);
}
