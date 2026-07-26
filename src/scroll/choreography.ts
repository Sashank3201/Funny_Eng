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
 */
export const KEYFRAMES: Keyframe[] = [
  {
    // Hero — hole right of centre, copy on the left, near edge-on for the
    // full Einstein-ring silhouette.
    id: 'hero',
    distance: 30,
    azimuth: 0,
    elevation: 0.10,
    focusX: 0.42,
    focusY: 0.02,
  },
  {
    // Work — pull back and drop the hole low and right, clearing the upper
    // two-thirds for project cards.
    id: 'work',
    distance: 64,
    azimuth: 0.55,
    elevation: 0.32,
    focusX: 0.82,
    focusY: -0.72,
  },
  {
    // About — swing round to the far side and tilt toward edge-on, so the disk
    // becomes a thin bright line. Kept right of centre like every other pose:
    // the copy column and the veil both run down the left, so the hole has to
    // stay out of that lane or the text loses its ground.
    id: 'about',
    distance: 50,
    azimuth: 1.5,
    elevation: 0.045,
    focusX: 0.74,
    focusY: -0.46,
  },
  {
    // Contact — push in close and centre it. Little copy here, so the
    // simulation can dominate.
    id: 'contact',
    distance: 28,
    azimuth: 2.4,
    elevation: 0.20,
    focusX: 0.68,
    focusY: -0.34,
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
 */
export function adaptForNarrow(pose: CameraState, aspect: number): CameraState {
  const fit = Math.min(2.2, Math.max(1, 1 / Math.max(aspect, 0.01))) * 0.95;
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
