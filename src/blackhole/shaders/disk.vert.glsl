// Accretion-disk vertex shader — velocity-aligned motion-blurred streaks.
//
// All motion is computed here from static per-particle orbital elements plus a
// clock uniform, so the CPU never touches a position buffer. `aElement` carries
// the orbital elements:
//   x -> normalised starting radius / migration phase (0..1)
//   y -> initial orbital angle θ₀ (radians)
//   z -> vertical offset within the disk scale height (-1..1)
//
// Requires the physics defines, lensing.glsl and streak.glsl to be prepended.

uniform float uTime;         // eased clock (seconds)
uniform float uSpin;         // global angular-speed multiplier
uniform float uDrift;        // inward migration rate
uniform float uScaleHeight;  // disk thickness coefficient
uniform float uSize;         // streak cross-section, in pixels
uniform vec2 uResolution;    // render-target size, in pixels
uniform float uBeamPower;    // Doppler beaming exponent (3 = specific intensity)
uniform float uEmissPower;   // emissivity vs. temperature exponent
uniform float uIntro;        // 0..1 intro reveal
uniform float uShutter;      // shutter interval, in simulation seconds
uniform float uMaxStreak;    // clamp on streak length, in NDC

attribute vec3 aElement;
attribute float aSeed;
attribute vec2 aCorner;      // base quad, -0.5..0.5

varying float vBright;
varying float vTemp;
varying float vFade;
varying vec2 vCorner;
varying vec2 vStreak;

/** Orbital radius and migration fade for a given migration phase. */
void orbitAt(float phase01, out float r, out float fade) {
  // Stateless inward migration: every particle sweeps from the outer edge down
  // to the ISCO and is silently recycled, mimicking viscous inflow.
  float u = fract(phase01);

  // An exponent below 1 biases sampling toward the inner disk, which is where a
  // real accretion disk is densest and hottest.
  r = mix(DISK_OUTER, DISK_INNER, pow(u, 0.55));

  // Fade in at the outer edge, fade out as material plunges through the ISCO,
  // so the recycling is invisible.
  fade = smoothstep(0.0, 0.26, u) * (1.0 - smoothstep(0.90, 1.0, u));
}

/** Disk position at a given absolute time. */
vec3 diskPos(float r, float phase, float thick, float t) {
  // Keplerian shear: Ω = √(M/r³). Inner material laps the outer disk, which is
  // what draws the particles out into spiral streaks.
  float theta = phase + t * sqrt(MASS / (r * r * r)) * uSpin;
  return vec3(r * cos(theta), thick * uScaleHeight * r, r * sin(theta));
}

void main() {
  float r01   = aElement.x;
  float phase = aElement.y;
  float thick = aElement.z;

  float r, fade;
  orbitAt(r01 + uTime * uDrift, r, fade);
  vFade = fade;

  vec3 pos = diskPos(r, phase, thick, uTime);
  float theta = phase + uTime * sqrt(MASS / (r * r * r)) * uSpin;

  vec4 world = modelMatrix * vec4(pos, 1.0);
  vec3 nHat = normalize(cameraPosition - world.xyz);

  // Prograde orbital velocity direction, in world space.
  vec3 vdir = normalize((modelMatrix * vec4(-sin(theta), 0.0, cos(theta), 0.0)).xyz);
  float beta = min(sqrt(MASS / r), 0.92);
  float betaLos = beta * dot(vdir, nHat);

  // Relativistic Doppler factor δ = 1/(γ(1 − β·n̂)) …
  float gammaInv = sqrt(1.0 - beta * beta);
  float delta = gammaInv / max(1.0 - betaLos, 0.05);
  // … and the gravitational redshift of light climbing out of the well.
  float grav = sqrt(max(0.0, 1.0 - RS / r));
  float g = delta * grav;

  // Shakura–Sunyaev temperature profile, then shifted into the observer frame.
  float tLocal = pow(DISK_INNER / r, TEMP_EXP);
  vTemp = clamp(tLocal * g * 0.8, 0.0, 1.0);
  vBright = pow(tLocal, uEmissPower) * pow(max(g, 0.001), uBeamPower) * uIntro;

  vec4 holeView = viewMatrix * modelMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vec4 holeClip = projectionMatrix * holeView;

  vec4 mv = viewMatrix * world;
  float behind = lensBehind(holeView.z, mv.z);
  vec4 clip = lensClip(projectionMatrix * mv, holeClip, behind);
  vBright *= shadowOcclusion(clip, holeClip, behind);

  // The same computation one shutter interval later gives the streak vector.
  float rNext, fadeNext;
  orbitAt(r01 + (uTime + uShutter) * uDrift, rNext, fadeNext);
  vec3 posNext = diskPos(rNext, phase, thick, uTime + uShutter);

  vec4 mvNext = viewMatrix * modelMatrix * vec4(posNext, 1.0);
  vec4 clipNext =
    lensClip(projectionMatrix * mvNext, holeClip, lensBehind(holeView.z, mvNext.z));

  vec2 ndc = clip.xy / max(clip.w, 1e-6);
  vec2 ndcNext = clipNext.xy / max(clipNext.w, 1e-6);

  // Cross-section is a fixed pixel width; hot inner material gets a fatter one.
  float widthNdc = uSize * 2.0 / max(uResolution.y, 1.0) * mix(0.6, 1.3, tLocal);

  Streak s = buildStreak(ndc, ndcNext, aCorner, widthNdc, uMaxStreak, uAspect);
  vBright *= s.dim;
  vCorner = aCorner;
  vStreak = s.info;

  // Undo the aspect correction on the way back into NDC.
  ndc += vec2(s.offset.x / uAspect, s.offset.y);
  gl_Position = vec4(ndc * clip.w, clip.z, clip.w);
}
