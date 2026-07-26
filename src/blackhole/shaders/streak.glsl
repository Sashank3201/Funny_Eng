// Shared motion-blur streak assembly.
//
// A particle is drawn as an instanced quad stretched along the direction it
// actually travels on screen during one shutter interval. Deriving the streak
// from two projected samples rather than from an instantaneous velocity means
// it inherits every distortion applied to the position — the Keplerian shear
// and the lensing warp both come along for free, so streaks bend correctly
// where they wrap around the shadow.

struct Streak {
  vec2 offset; // corner displacement, in aspect-corrected NDC
  vec2 info;   // x = quad length / width, y = fraction of length that is core
  float dim;   // energy-conserving brightness scale
};

Streak buildStreak(
  vec2 ndc,
  vec2 ndcNext,
  vec2 corner,
  float widthNdc,
  float maxStreak,
  float aspect
) {
  vec2 travel = (ndcNext - ndc) * vec2(aspect, 1.0);
  float travelLen = length(travel);

  // A hard clamp matters: a particle crossing its recycling seam, or one whose
  // lensing blend flips between the two samples, would otherwise draw a streak
  // clear across the frame.
  float streak = min(travelLen, maxStreak);

  vec2 along = travelLen > 1e-5 ? travel / travelLen : vec2(1.0, 0.0);
  vec2 across = vec2(-along.y, along.x);

  float quadLen = streak + widthNdc;

  Streak s;
  s.offset = along * (corner.x * quadLen) + across * (corner.y * widthNdc);
  s.info = vec2(quadLen / max(widthNdc, 1e-6), streak / max(quadLen, 1e-6));
  // Longer streaks spread the same energy over more pixels, so dim them to
  // conserve it — otherwise the fast inner disk turns into a solid white band.
  s.dim = widthNdc / max(quadLen, 1e-6);
  return s;
}

/** Soft capsule coverage for a streak fragment. `corner` is the -0.5..0.5 quad
 *  coordinate, `info` the varying produced by buildStreak. */
float streakCoverage(vec2 corner, vec2 info) {
  float ratio = info.x;
  float halfCore = info.y * ratio * 0.5;
  float u = corner.x * ratio;
  float v = corner.y;
  // Distance to the central line segment gives rounded caps for free.
  float d = length(vec2(max(abs(u) - halfCore, 0.0), v));
  return exp(-d * d * 16.0);
}
