// Accretion-disk particle vertex shader.
//
// All motion is computed here from static per-particle orbital elements plus a
// clock uniform, so the CPU never touches a position buffer. `position` carries
// the orbital elements rather than a literal location:
//   position.x -> normalised starting radius / migration phase (0..1)
//   position.y -> initial orbital angle θ₀ (radians)
//   position.z -> vertical offset within the disk scale height (-1..1)

uniform float uTime;         // eased clock (seconds)
uniform float uSpin;         // global angular-speed multiplier
uniform float uDrift;        // inward migration rate
uniform float uScaleHeight;  // disk thickness coefficient
uniform float uSize;         // base point size
uniform float uPixelRatio;
uniform float uAspect;
uniform float uBeamPower;    // Doppler beaming exponent (3 = specific intensity)
uniform float uEmissPower;   // emissivity vs. temperature exponent
uniform float uLensStrength; // screen-space deflection coefficient
uniform float uShadowNdc;    // shadow radius in aspect-corrected NDC
uniform float uWarp;         // 0..1 master for the back-side lensing arc
uniform float uIntro;        // 0..1 intro reveal

attribute float aSeed;

varying float vBright;
varying float vTemp;
varying float vFade;

void main() {
  float r01   = position.x;
  float phase = position.y;
  float thick = position.z;

  // Stateless inward migration: every particle sweeps from the outer edge down
  // to the ISCO and is silently recycled, mimicking viscous inflow.
  float u = fract(r01 + uTime * uDrift);

  // An exponent below 1 biases sampling toward the inner disk, which is where a
  // real accretion disk is densest and hottest.
  float r = mix(DISK_OUTER, DISK_INNER, pow(u, 0.55));

  // Fade in at the outer edge, fade out as material plunges through the ISCO,
  // so the recycling is invisible.
  vFade = smoothstep(0.0, 0.26, u) * (1.0 - smoothstep(0.90, 1.0, u));

  // Keplerian shear: Ω = √(M/r³). Inner material laps the outer disk, which is
  // what draws the particles out into spiral streaks.
  float omega = sqrt(MASS / (r * r * r));
  float theta = phase + uTime * omega * uSpin;

  float ct = cos(theta);
  float st = sin(theta);

  // Geometrically thin disk whose scale height grows with radius.
  float h = thick * uScaleHeight * r;
  vec3 pos = vec3(r * ct, h, r * st);

  vec4 world = modelMatrix * vec4(pos, 1.0);
  vec3 nHat = normalize(cameraPosition - world.xyz);

  // Prograde orbital velocity direction, in world space.
  vec3 vdir = normalize((modelMatrix * vec4(-st, 0.0, ct, 0.0)).xyz);
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

  // Beaming: observed intensity scales as g^3.
  vBright = pow(tLocal, uEmissPower) * pow(max(g, 0.001), uBeamPower) * uIntro;

  vec4 mv = viewMatrix * world;
  vec4 clip = projectionMatrix * mv;

  // ---- Screen-space lensing of the disk itself ----------------------------
  // Light leaving the far side of the disk grazes the hole and is bent up and
  // over it, so the back of the disk appears as arcs above and below the
  // shadow instead of being occluded by it.
  vec4 holeView = viewMatrix * modelMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vec4 holeClip = projectionMatrix * holeView;

  if (clip.w > 0.0 && holeClip.w > 0.0 && uWarp > 0.0) {
    vec2 pN = clip.xy / clip.w;
    vec2 hN = holeClip.xy / holeClip.w;
    vec2 d = (pN - hN) * vec2(uAspect, 1.0);
    float b = max(length(d), 1e-4);
    vec2 dir = d / b;

    // Only material further from the camera than the hole gets lensed around it.
    float behind = smoothstep(0.0, 2.0 * RS, holeView.z - mv.z);
    float w = behind * uWarp;

    if (w > 0.0) {
      // Where does a source at impact parameter b appear? Solving the lens
      // equation b_img − α(b_img) = b with α = k/b_img gives
      //   b_img = ½(b + √(b² + 4k))
      // Solving it this way rather than adding α(b) directly is what keeps the
      // far side of the disk finite: a source sitting exactly behind the hole
      // maps to √k — a ring — instead of being flung to infinity.
      float bOut = 0.5 * (b + sqrt(b * b + 4.0 * uLensStrength));
      bOut = max(bOut, uShadowNdc * 1.02);
      vec2 nOut = hN + (dir * mix(b, bOut, w)) / vec2(uAspect, 1.0);
      clip.xy = nOut * clip.w;
    }
  }

  gl_Position = clip;

  // Hot inner material gets fatter sprites; the sparse outer disk gets fine
  // ones, so it dissolves into a haze instead of breaking up into speckle.
  float sizeByTemp = mix(0.5, 1.35, tLocal);

  float dist = max(-mv.z, 0.001);
  gl_PointSize =
    clamp(uSize * uPixelRatio * sizeByTemp * (10.0 / dist) * (0.55 + 0.9 * aSeed), 0.7, 9.0);
}
