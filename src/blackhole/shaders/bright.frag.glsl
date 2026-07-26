// Bloom bright-pass with a soft knee, so the glow ramps in rather than
// switching on at a hard threshold.

precision highp float;

uniform sampler2D uScene;
uniform float uThreshold;
uniform float uKnee;
uniform float uBloomClamp;

varying vec2 vUv;

void main() {
  vec3 c = texture2D(uScene, vUv).rgb;
  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));

  float knee = max(uKnee, 1e-4);
  float soft = clamp(lum - uThreshold + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee);
  float contrib = max(soft, lum - uThreshold) / max(lum, 1e-4);

  vec3 bright = c * contrib;

  // Bound how hard a single source can drive the glare.
  //
  // Relativistic beaming leaves the approaching limb 20-80x the receding one
  // (g⁴, with g_app/g_rec = 2.14 at the flux peak and 3.0 at the ISCO). Above
  // the threshold `contrib` tends to 1, so without this the bright pass hands
  // that entire unbounded magnitude to a wide blur pyramid — and the halo it
  // paints back is several times thicker than the disk itself, which is what
  // turned the approaching side into a featureless white continent.
  //
  // The excess is compressed logarithmically rather than clipped, so brighter
  // really does still mean brighter, just far less than linearly. All three
  // channels scale by the same factor, so the glare keeps the hue of whatever
  // cast it instead of bleaching toward white.
  float m = max(max(bright.r, bright.g), bright.b);
  if (m > uBloomClamp) {
    bright *= (uBloomClamp * (1.0 + log(m / uBloomClamp))) / m;
  }

  gl_FragColor = vec4(bright, 1.0);
}
