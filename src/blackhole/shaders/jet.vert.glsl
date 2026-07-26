// Relativistic jet vertex shader.
//
// Twin collimated outflows along the spin axis, drawn with the same
// motion-blurred streak machinery as the disk. `aJet` carries:
//   x -> lifetime phase (0..1)
//   y -> launch azimuth (radians)
//   z -> fractional radius within the launch annulus (0..1)
//
// PHYSICS NOTE: a Schwarzschild hole cannot launch jets. Blandford–Znajek
// extracts rotational energy through the ergosphere, which requires spin, so a
// jetted hole is a Kerr hole. Everything else in this scene is Schwarzschild;
// the jets are the one element that implies spin, kept because they are the
// most recognisable thing an accreting black hole does.
//
// Requires the physics defines, lensing.glsl and streak.glsl to be prepended.

uniform float uTime;
uniform float uRate;        // lifetime turnover rate
uniform float uLaunch;      // launch height above the hole, in Rs
uniform float uLength;      // jet length, in Rs
uniform float uBaseRadius;  // launch annulus radius, in Rs
uniform float uOpening;     // cone half-angle, radians
uniform float uTwist;       // helical winding per Rs of height
uniform float uTurbulence;
uniform float uBeta;        // bulk outflow speed, as a fraction of c
uniform float uBeamPower;
uniform float uSize;        // streak cross-section, in pixels
uniform vec2 uResolution;
uniform float uIntro;
uniform float uShutter;
uniform float uMaxStreak;

attribute vec3 aJet;
attribute float aSeed;
attribute vec2 aCorner;

varying float vBright;
varying float vTemp;
varying float vFade;
varying vec2 vCorner;
varying vec2 vStreak;

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  return fract(p * (p + p));
}

/**
 * Jet position at lifetime phase `t`. Material accelerates away from the base,
 * spirals as it goes (a stand-in for magnetic collimation), and wanders under
 * turbulence that grows with distance as the flow decollimates.
 */
vec3 jetPos(float t, float azimuth, float radial, float side, float seed) {
  // Accelerating outflow: slow near the base knot, fast once collimated.
  // The launch point sits outside the shadow radius on purpose — a jet rooted
  // any closer projects inside the silhouette and smears grey haze across it.
  float h = uLaunch + uLength * pow(t, 1.35);

  // Narrow cone, opening with distance.
  float rad = uBaseRadius * (0.35 + 0.65 * radial) + h * tan(uOpening);

  float az = azimuth + h * uTwist * side;

  // Turbulence grows downstream, so the jet frays at the tip.
  float wobble = uTurbulence * h * 0.06;
  float n1 = sin(h * 0.55 + seed * 40.0) + 0.5 * sin(h * 1.3 + seed * 71.0);
  float n2 = cos(h * 0.47 + seed * 53.0) + 0.5 * cos(h * 1.7 + seed * 29.0);

  return vec3(
    rad * cos(az) + n1 * wobble,
    side * h,
    rad * sin(az) + n2 * wobble
  );
}

void main() {
  float life = aJet.x;
  float azimuth = aJet.y;
  float radial = aJet.z;
  float side = aSeed < 0.5 ? -1.0 : 1.0;
  float seed = hash11(aSeed * 977.0 + azimuth);

  float t = fract(life + uTime * uRate);

  // Bright at the base knot, fading out along the length.
  vFade = smoothstep(0.0, 0.04, t) * (1.0 - smoothstep(0.22, 0.85, t));

  vec3 pos = jetPos(t, azimuth, radial, side, seed);
  vec4 world = modelMatrix * vec4(pos, 1.0);
  vec3 nHat = normalize(cameraPosition - world.xyz);

  // Bulk motion is along the axis, so the Doppler factor is dominated by the
  // transverse term: viewed side-on the jets are *de*-boosted, and the small
  // camera elevation tips one toward us and one away. That asymmetry — one jet
  // brighter than its twin — is real, and it is the reason astronomers often
  // see only one.
  vec3 vdir = normalize((modelMatrix * vec4(0.0, side, 0.0, 0.0)).xyz);
  float beta = uBeta;
  float betaLos = beta * dot(vdir, nHat);
  float gammaInv = sqrt(1.0 - beta * beta);
  float delta = gammaInv / max(1.0 - betaLos, 0.05);

  // Gravitational redshift at the launch point.
  float h = length(pos);
  float grav = sqrt(max(0.0, 1.0 - RS / max(h, RS * 1.05)));
  float g = delta * grav;

  // Hot and blue-white at the base, cooling along the flow.
  float tLocal = 1.0 - smoothstep(0.0, 0.75, t);
  vTemp = clamp(0.55 + 0.45 * tLocal * g, 0.0, 1.0);
  vBright = (0.25 + 0.75 * tLocal) * pow(max(g, 0.001), uBeamPower) * uIntro;

  vec4 holeView = viewMatrix * modelMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vec4 holeClip = projectionMatrix * holeView;

  vec4 mv = viewMatrix * world;
  float behind = lensBehind(holeView.z, mv.z);
  vec4 clip = lensClip(projectionMatrix * mv, holeClip, behind);
  vBright *= shadowOcclusion(clip, holeClip, behind);

  vec3 posNext = jetPos(fract(t + uShutter * uRate), azimuth, radial, side, seed);
  vec4 mvNext = viewMatrix * modelMatrix * vec4(posNext, 1.0);
  vec4 clipNext =
    lensClip(projectionMatrix * mvNext, holeClip, lensBehind(holeView.z, mvNext.z));

  vec2 ndc = clip.xy / max(clip.w, 1e-6);
  vec2 ndcNext = clipNext.xy / max(clipNext.w, 1e-6);

  float widthNdc = uSize * 2.0 / max(uResolution.y, 1.0);

  Streak s = buildStreak(ndc, ndcNext, aCorner, widthNdc, uMaxStreak, uAspect);
  vBright *= s.dim;
  vCorner = aCorner;
  vStreak = s.info;

  ndc += vec2(s.offset.x / uAspect, s.offset.y);
  gl_Position = vec4(ndc * clip.w, clip.z, clip.w);
}
