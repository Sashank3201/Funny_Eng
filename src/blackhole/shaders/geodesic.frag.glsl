// Null-geodesic raymarcher for a Schwarzschild black hole.
//
// One photon path integrated per pixel, backwards from the camera. Photon
// motion in Schwarzschild geometry is planar, so each ray collapses to a 2-D
// problem in its own orbital plane, governed exactly by the Binet form
//
//     d²u/dφ² = 3Mu² − u        (u = 1/r)
//
// There is no weak-field expansion here and no fitted constant. The shadow, the
// photon ring, the Einstein ring and the disk's secondary image are not drawn —
// they emerge because rays genuinely wind around the hole and cross the
// equatorial plane more than once.
//
// Requires: physics defines, noise.glsl, sky.glsl, disk.glsl, jet.glsl, and a
// MAX_STEPS define injected per quality tier.

precision highp float;

uniform vec3 uCamPos;
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform vec3 uCamFwd;
uniform vec2 uResolution;
uniform float uTanHalfFov;
uniform vec2 uJitter;      // sub-pixel offset, in pixels, for temporal AA
uniform float uSkyBrightness;
uniform float uIntro;      // 0..1 — eases the curvature up on load
uniform float uJetOn;
uniform float uFlatSky;  // 1 = uniform white sky, for the physics self-test

varying vec2 vUv;

/** Angular step, finer near the hole where the trajectory actually bends. */
float stepFor(float r) {
  return DPHI_MAX * clamp(r / (6.0 * RS), 0.07, 1.0);
}

void main() {
  // ---- Primary ray -------------------------------------------------------
  vec2 ndc = vUv * 2.0 - 1.0;
  ndc += (uJitter / uResolution) * 2.0;

  float aspect = uResolution.x / max(uResolution.y, 1.0);
  vec3 dir = normalize(
    uCamRight * (ndc.x * uTanHalfFov * aspect) +
    uCamUp * (ndc.y * uTanHalfFov) +
    uCamFwd
  );

  vec3 ro = uCamPos;
  float r0 = length(ro);
  vec3 e1 = ro / r0;

  // The orbital plane is spanned by the camera's radius vector and the ray.
  vec3 perp = dir - dot(dir, e1) * e1;
  float perpLen = length(perp);

  vec3 sky = uFlatSky > 0.5 ? vec3(1.0) : skyRadiance(dir) * uSkyBrightness;

  // A perfectly radial ray has no orbital plane; it flies straight in or out.
  if (perpLen < 1e-5) {
    gl_FragColor = vec4(dot(dir, e1) < 0.0 ? vec3(0.0) : sky, 1.0);
    return;
  }

  vec3 e2 = perp / perpLen;
  vec3 planeNormal = cross(e1, e2);

  // Initial conditions. du/dφ = −u (d·e₁)/(d·e₂), and d·e₂ = perpLen.
  float u = 1.0 / r0;
  float w = -u * dot(dir, e1) / perpLen;

  // Impact parameter from the null energy equation, 1/b² = w² + u²(1 − 2Mu).
  float bInv2 = w * w + u * u * (1.0 - 2.0 * MASS * u);
  float b = inversesqrt(max(bInv2, 1e-12));

  // Conserved L_z/E. Negated because we march backwards along the path the
  // photon actually travelled, so its momentum is opposite our ray direction.
  float lambda = -b * planeNormal.y;

  // Curvature eases in over the intro, so the hole appears to switch on.
  float mass = MASS * uIntro;

  // ---- Equatorial crossings, known in advance ----------------------------
  // The ray's height above the disk plane is
  //   h(φ) = e₁.y cos φ + e₂.y sin φ = C sin(φ + ψ)
  // so the crossings sit at φ = nπ − ψ. Solving for them up front removes two
  // trig calls per integration step and gives an exact crossing angle rather
  // than one recovered by bisection.
  float A = e1.y;
  float B = e2.y;
  float C = sqrt(A * A + B * B);
  float psi = atan(A, B);
  bool planeIsEquatorial = C < 1e-4;

  float nextCross = ceil(psi / PI) * PI - psi;
  if (nextCross <= 1e-4) nextCross += PI;

  // ---- March -------------------------------------------------------------
  float phi = 0.0;
  vec3 emission = vec3(0.0);   // jet light picked up along the way
  vec3 diskColour = vec3(0.0);
  bool hitDisk = false;
  bool captured = false;
  bool escaped = false;

  for (int i = 0; i < MAX_STEPS; i++) {
    float r = 1.0 / u;
    float h = stepFor(r);

    float uPrev = u;
    float phiPrev = phi;

    // RK4 on (u' = w, w' = 3Mu² − u).
    float k1u = w;
    float k1w = 3.0 * mass * u * u - u;

    float u2 = u + 0.5 * h * k1u;
    float k2u = w + 0.5 * h * k1w;
    float k2w = 3.0 * mass * u2 * u2 - u2;

    float u3 = u + 0.5 * h * k2u;
    float k3u = w + 0.5 * h * k2w;
    float k3w = 3.0 * mass * u3 * u3 - u3;

    float u4 = u + h * k3u;
    float k4u = w + h * k3w;
    float k4w = 3.0 * mass * u4 * u4 - u4;

    u += (h / 6.0) * (k1u + 2.0 * k2u + 2.0 * k3u + k4u);
    w += (h / 6.0) * (k1w + 2.0 * k2w + 2.0 * k3w + k4w);
    phi += h;

    // Swallowed by the horizon.
    if (u > 1.0 / (2.0 * MASS * 1.02)) {
      captured = true;
      break;
    }
    if (u <= 0.0) {
      escaped = true;
      break;
    }

    // Did this step carry us through the disk plane?
    if (!planeIsEquatorial && phi >= nextCross && phiPrev < nextCross) {
      float t = (nextCross - phiPrev) / h;
      float uc = mix(uPrev, u, t);
      float rc = 1.0 / max(uc, 1e-6);

      if (rc >= DISK_INNER && rc <= DISK_OUTER) {
        vec3 pc = rc * (cos(nextCross) * e1 + sin(nextCross) * e2);
        diskColour = diskEmission(pc, rc, lambda);
        hitDisk = true;
        // The disk is optically thick: the first crossing inside the annulus
        // is where the ray stops. Crossings outside it pass straight through,
        // which is exactly how the secondary image forms — those rays sail
        // over the hole and strike the far side of the disk from beneath.
        break;
      }
      nextCross += PI;
    }

    // Jet volume, integrated along the path.
    if (uJetOn > 0.5) {
      float rr = 1.0 / u;
      if (rr < uJetLength * 1.2) {
        vec3 p = rr * (cos(phi) * e1 + sin(phi) * e2);
        emission += jetEmission(p) * h * rr * 0.06;
      }
    }

    // Escaped to infinity.
    if (u < 1.0 / ESCAPE_RADIUS && w < 0.0) {
      escaped = true;
      break;
    }
  }

  // ---- Shade -------------------------------------------------------------
  vec3 colour = emission;

  if (hitDisk) {
    colour += diskColour;
  } else if (escaped) {
    // The ray's asymptotic direction, reconstructed from the final state.
    float r = 1.0 / u;
    float drdphi = -w / (u * u);
    float cp = cos(phi), sp = sin(phi);
    vec3 radial = cp * e1 + sp * e2;
    vec3 tangential = -sp * e1 + cp * e2;
    vec3 outDir = normalize(drdphi * radial + r * tangential);
    colour += uFlatSky > 0.5 ? vec3(1.0) : skyRadiance(outDir) * uSkyBrightness;
  }
  // Neither: captured, or out of steps deep in the winding region just outside
  // the photon sphere. Both read as shadow, which is what they are.

  gl_FragColor = vec4(colour, 1.0);
}
