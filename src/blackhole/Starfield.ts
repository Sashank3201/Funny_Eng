import { Vector2 } from 'three';

import { FullscreenPass } from './fullscreen';
import starsFrag from './shaders/stars.frag.glsl?raw';

/**
 * Procedural background starfield rendered as a fullscreen pass. It is drawn
 * first, into its own target, so the lensing pass has something to bend.
 */
export function createStarfield(): FullscreenPass {
  return new FullscreenPass(starsFrag, {
    uResolution: { value: new Vector2(1, 1) },
    uTime: { value: 0 },
    uParallax: { value: new Vector2(0, 0) },
    uIntensity: { value: 1 },
  });
}
