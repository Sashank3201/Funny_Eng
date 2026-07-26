// Final composite: bloom, anamorphic streak, halation, filmic grade, lens
// artefacts, grain, sRGB encode.

precision highp float;

uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform sampler2D uStreak;
uniform sampler2D uBase;
uniform float uBloomIntensity;
uniform float uStreakIntensity;
uniform float uHalation;
uniform float uExposure;
uniform float uTime;
uniform float uAberration;
uniform float uGrain;
uniform float uVignette;
uniform float uContrast;
uniform float uSaturation;
uniform float uKneeThreshold;
uniform float uKneeStrength;
uniform float uDetail;
uniform vec3 uShadowTint;
uniform vec3 uHighlightTint;

varying vec2 vUv;

/**
 * Highlight shoulder.
 *
 * The disk spans roughly 70:1 between its approaching and receding limbs,
 * because relativistic beaming scales observed intensity as g⁴. Lowering
 * exposure to stop the bright limb clipping takes the dim limb down with it and
 * loses that side instead, so instead only what is above the threshold gets
 * compressed and the shadows and midtones pass through untouched.
 *
 * The compression is logarithmic, not Reinhard. A Reinhard rolloff on the
 * excess, `T + e/(1+ke)`, converges on `T + 1/k` — so every value past a few
 * multiples of the threshold lands within a hair of the same number. At
 * T=0.80, k=0.70 that put excesses of 5 and 200 at 0.910 and 0.926 on screen:
 * a 40:1 range in the bright limb rendered as a 1.8 % difference, which is why
 * the approaching side read as one flat slab. `T + s·ln(1 + e/s)` is unbounded
 * and its slope decays instead of vanishing, so a ratio in the highlights stays
 * a visible ratio.
 *
 * It is applied to luminance with the channels scaled by the result, not
 * per-channel. Compressing each channel separately drives R, G and B toward a
 * common ceiling and bleaches the hottest gas to paper white; scaling by a
 * single factor keeps its colour.
 *
 * This is a display mapping. It changes nothing about the g⁴ physics that
 * produced the range.
 */
float shoulder(float l) {
  if (l <= uKneeThreshold) return l;
  return uKneeThreshold + uKneeStrength * log(1.0 + (l - uKneeThreshold) / uKneeStrength);
}

/**
 * Local tone mapping.
 *
 * The shoulder above is global, and a global curve cannot solve this. Measured
 * through the whole chain, a 2:1 change in scene value separates by 0.116 on the
 * receding limb, where values sit near 0.5, and by 0.011 on the approaching limb
 * at 40–80. Retuning the curve moves that second number to 0.015 at best: past
 * the knee, ACES is nearly flat, so *any* monotone mapping that fits the 80:1
 * beaming ratio on screen throws away the texture inside the bright side. That
 * is why the approaching limb read as white paint while the receding one kept
 * its filaments.
 *
 * So the low frequencies and the high frequencies are mapped separately. A
 * blurred copy of the scene gives the local average; the ratio of the pixel to
 * that average is the local structure. The average is compressed hard, the ratio
 * is put back nearly intact, and detail survives compression that would
 * otherwise flatten it. This is how eyes work — adaptation is local, not global.
 *
 * The ratio is clamped because the alternative is ringing: at the shadow's edge
 * the local average is meaningless and an unbounded ratio paints a bright halo
 * along it.
 */
vec3 localTonemap(vec3 c, float baseLum) {
  float l = max(dot(c, vec3(0.2126, 0.7152, 0.0722)), 1e-5);
  float base = max(baseLum, 1e-4);

  // `shoulder(l)`, not `shoulder(base)`. Compressing the base and multiplying
  // the ratio back is textbook local tone mapping, and it is wrong here: it
  // normalises every region to its own local average, which flattens the very
  // thing that makes this image — the 80:1 beaming between the limbs. Tried it,
  // and the disk turned into one even cream-coloured ring with the receding
  // side's amber gone.
  //
  // Compressing the pixel globally keeps that relationship exactly as it was,
  // and the base is used only to recover the high-frequency part the compression
  // flattens. Where the scene is locally flat the ratio is 1 and this reduces to
  // the plain global curve.
  float detail = clamp(l / base, 0.3, 3.0);
  float mapped = shoulder(l) * pow(detail, uDetail);

  return c * (mapped / l);
}

// Narkowicz's ACES approximation — keeps the blown-out inner disk from
// clipping to flat white.
vec3 acesFilm(vec3 x) {
  const float a = 2.51;
  const float b = 0.03;
  const float c = 2.43;
  const float d = 0.59;
  const float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

float hash21(vec2 p) {
  p = fract(p * vec2(233.34, 851.73));
  p += dot(p, p + 23.45);
  return fract(p.x * p.y);
}

vec3 toSrgb(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(max(c, 1e-5), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

void main() {
  vec2 d = vUv - 0.5;
  float r2 = dot(d, d);

  // Chromatic aberration that only bites toward the frame edges.
  vec2 off = d * r2 * uAberration;
  vec3 col;
  col.r = texture2D(uScene, vUv + off).r;
  col.g = texture2D(uScene, vUv).g;
  col.b = texture2D(uScene, vUv - off).b;

  vec3 bloom = texture2D(uBloom, vUv).rgb;
  col += bloom * uBloomIntensity;

  // Halation: on film the red-sensitive layer scatters furthest, so highlights
  // bleed warm. Reusing the bloom buffer weighted toward red costs nothing.
  col += bloom * vec3(1.0, 0.34, 0.12) * uHalation;

  // Anamorphic horizontal flare, biased cool so it reads as a lens artefact
  // rather than as more disk.
  col += texture2D(uStreak, vUv).rgb * vec3(0.55, 0.75, 1.0) * uStreakIntensity;

  // The base layer is the blurred scene, so it takes the same exposure as the
  // scene does before the two are compared.
  vec3 baseCol = texture2D(uBase, vUv).rgb * uExposure;
  float baseLum = dot(baseCol, vec3(0.2126, 0.7152, 0.0722));

  // Glare is added before tone mapping so it is compressed along with
  // everything else, but it must not pollute the base layer — the base is what
  // the scene's own low frequencies are, not what the glare made of them.
  col = acesFilm(localTonemap(col * uExposure, baseLum));

  // Filmic S-curve.
  col = mix(col, col * col * (3.0 - 2.0 * col), uContrast);

  // ACES pulls saturation out of the highlights, which greys the hottest part
  // of the disk. Push a little back before the split-tone.
  float grey = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(grey), col, uSaturation);

  // Split-toning: cool shadows, warm highlights. Subtle, and it is what makes
  // the amber disk sit in the frame rather than on top of it.
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col *= mix(uShadowTint, uHighlightTint, smoothstep(0.0, 0.7, lum));

  // Vignette pulls the eye to the centre of the frame.
  col *= 1.0 - uVignette * smoothstep(0.15, 0.75, r2);

  // A little grain hides banding across the large dark gradients.
  float n = hash21(vUv * 1024.0 + fract(uTime) * 91.7) - 0.5;
  col += n * uGrain;

  gl_FragColor = vec4(toSrgb(max(col, 0.0)), 1.0);
}
