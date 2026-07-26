import type { CameraState } from '../blackhole/GeodesicRenderer';

/**
 * Scroll choreography.
 *
 * This is the mechanic the whole design rests on. The page has no panels behind
 * its text — instead the camera is moved so the bright parts of the scene are
 * never where the words are. Contrast comes from composition, which is only
 * possible because we control what the renderer draws and where.
 *
 * Each section declares the pose it wants. The renderer damps toward it, so
 * scrolling reframes the black hole continuously rather than in steps.
 */

export interface Keyframe extends CameraState {
  /** Section id this pose belongs to. */
  id: string;
}

/**
 * Poses, in document order.
 *
 * `focusX`/`focusY` place the hole in NDC: positive X is right of centre,
 * positive Y is above. Elevation near zero is near edge-on, which is where the
 * lensed secondary image reads most clearly.
 *
 * Two rules every pose obeys.
 *
 * First, the *core* — shadow, photon ring and the secondary arcs, roughly 280 px
 * across at distance 30 on a 900 px-tall viewport — is fully on screen and clear
 * of the copy.
 *
 * Second, and this is the one that was missing: the **approaching limb tapers
 * inside the frame**. It used to be treated as "only the dim outer disk crops at
 * the edge", but relativistic beaming makes that limb the brightest thing in the
 * picture — 20:1 over the receding side at the flux peak and 80:1 at the ISCO —
 * so cropping it leaves a hard vertical wall of white against the bezel while
 * the receding side tapers to a wisp. Measured before this was fixed, the
 * rightmost pixels peaked at 0.93 luminance in all four sections.
 *
 * The limb reaches further than the disk's 10 Rs because its glare goes with it,
 * so the margin is set from measurement (`edge-check.mjs`) rather than geometry.
 */
export const KEYFRAMES: Keyframe[] = [
  {
    // Hero — the reference pose. Near edge-on, which is what produces the
    // Einstein-ring silhouette with the disk arcing over *and* under.
    id: 'hero',
    distance: 33,
    azimuth: 0,
    elevation: 0.10,
    focusX: 0.24,
    focusY: 0.02,
  },
  {
    // Work — same distance, so it stays the same size. Tilted a little further
    // open than the hero for variety, and lifted slightly so the project rows
    // run under the disk rather than through the core.
    id: 'work',
    distance: 33,
    azimuth: 1.15,
    elevation: 0.165,
    focusX: 0.30,
    focusY: 0.10,
  },
  {
    // About — the thinnest inclination on the page. Almost perfectly edge-on,
    // so the disk collapses to a blade of light through the photon ring.
    id: 'about',
    distance: 32,
    azimuth: 2.35,
    elevation: 0.045,
    focusX: 0.30,
    focusY: -0.14,
  },
  {
    // Contact — closest, and the only pose where the hole is allowed to
    // dominate, because there is barely any copy here to protect.
    id: 'contact',
    distance: 29,
    azimuth: 3.5,
    elevation: 0.125,
    focusX: 0.22,
    focusY: -0.22,
  },
];

/** Smoothstep — C¹ continuous, so blended poses have no velocity discontinuity. */
function smoothstep(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function blend(a: CameraState, b: CameraState, t: number): CameraState {
  const k = smoothstep(t);
  return {
    distance: lerp(a.distance, b.distance, k),
    azimuth: lerp(a.azimuth, b.azimuth, k),
    elevation: lerp(a.elevation, b.elevation, k),
    focusX: lerp(a.focusX, b.focusX, k),
    focusY: lerp(a.focusY, b.focusY, k),
  };
}

/**
 * Pose for a continuous scroll position, where `progress` runs 0..1 across the
 * whole document. Interpolates between adjacent keyframes rather than snapping
 * at section boundaries.
 */
export function poseForProgress(progress: number): CameraState {
  const n = KEYFRAMES.length;
  if (n === 1) return KEYFRAMES[0];

  const scaled = Math.min(Math.max(progress, 0), 1) * (n - 1);
  const i = Math.min(n - 2, Math.floor(scaled));
  return blend(KEYFRAMES[i], KEYFRAMES[i + 1], scaled - i);
}

/**
 * Narrow viewports stack the copy under the hole rather than beside it, so the
 * horizontal offsets collapse and the hole lifts instead.
 *
 * The distance also has to grow. The field of view is vertical, so a fixed
 * camera distance sizes the hole against height alone — fine in landscape, and
 * badly wrong on a tall phone, where the disk grows until it runs off both
 * edges. Scaling by the inverse aspect frames it against the *smaller*
 * dimension instead, which is what keeps the whole disk on screen.
 *
 * The trailing factor is margin — above 1 it pulls the camera back, which is the
 * direction that shrinks the hole. It used to be 0.95, i.e. slightly *closer*
 * than the bare aspect fit, which fitted the disk's geometry and nothing else.
 * That was not enough: the approaching limb carries a glare halo reaching past
 * 10 Rs, and on a phone there is no room to spare — cropping it was exactly what
 * made the limb read as a wall of white against the right bezel.
 *
 * 1.06 is the measured value, not a guess. At 393×852 it puts the peak luminance
 * in the outermost columns at 0.35 on the left and 0.35 on the right — both equal
 * to the bare sky, which is what "the limb ends before the frame does" looks like
 * numerically. Anything below about 1.05 starts to clip the limb again.
 */
export function adaptForNarrow(pose: CameraState, aspect: number): CameraState {
  const fit = Math.min(2.2, Math.max(1, 1 / Math.max(aspect, 0.01))) * 1.06;
  return {
    ...pose,
    distance: pose.distance * fit,
    focusX: pose.focusX * 0.18,
    focusY: pose.focusY * 0.3 + 0.44,
  };
}

/** Pointer parallax, applied on top of the scroll pose. Bounded and small. */
export function applyPointer(pose: CameraState, px: number, py: number): CameraState {
  return {
    ...pose,
    azimuth: pose.azimuth + px * 0.10,
    elevation: pose.elevation + py * 0.045,
  };
}
