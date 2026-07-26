// Combine the lensed background with the temporally accumulated disk and jets.
// Kept as its own pass so the accumulation buffer holds only the emissive
// layer — blending the stars into the history would smear them too.

precision highp float;

uniform sampler2D uBackground;
uniform sampler2D uEmissive;

varying vec2 vUv;

void main() {
  vec3 bg = texture2D(uBackground, vUv).rgb;
  vec3 em = texture2D(uEmissive, vUv).rgb;
  gl_FragColor = vec4(bg + em, 1.0);
}
