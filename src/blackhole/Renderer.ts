import {
  Clock,
  HalfFloatType,
  LinearFilter,
  LinearSRGBColorSpace,
  PerspectiveCamera,
  RGBAFormat,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';

import { Disk } from './Disk';
import { FullscreenPass } from './fullscreen';
import { RS, SHADOW_RADIUS } from './physics';
import { createStarfield } from './Starfield';
import { QualityGovernor, detectTier, type Tier } from './quality';

import brightFrag from './shaders/bright.frag.glsl?raw';
import blurFrag from './shaders/blur.frag.glsl?raw';
import compositeFrag from './shaders/composite.frag.glsl?raw';
import lensFrag from './shaders/lens.frag.glsl?raw';

const FOV = 42;
/** Camera distance from the hole, in Schwarzschild radii. */
const CAM_DISTANCE = 26 * RS;
/** Elevation above the disk plane. Near edge-on is what makes the lensed arc read. */
const CAM_ELEVATION = 0.20; // radians, ≈ 11°

/**
 * Where light from directly behind the hole re-emerges, as a multiple of the
 * shadow radius. Real strongly-lensed images pile up in a thin annulus just
 * outside the photon ring, so this sits a little above 1.
 */
const ARC_RATIO = 1.16;

/** Duration of the opening dolly-in and reveal. */
const INTRO_SECONDS = 2.2;

export interface BlackHoleOptions {
  canvas: HTMLCanvasElement;
  /** Render a single frame and never start the loop. */
  reducedMotion?: boolean;
  /** Multiplier on the deflection strength. 1.0 puts the lensed arc at ARC_RATIO. */
  lensScale?: number;
}

export class BlackHoleRenderer {
  private readonly renderer: WebGLRenderer;
  private readonly camera: PerspectiveCamera;
  private readonly scene = new Scene();
  private readonly clock = new Clock();
  private readonly disk: Disk;
  private readonly stars: FullscreenPass;
  private readonly lens: FullscreenPass;
  private readonly bright: FullscreenPass;
  private readonly blur: FullscreenPass;
  private readonly composite: FullscreenPass;
  private readonly governor: QualityGovernor;

  private rtStars!: WebGLRenderTarget;
  private rtScene!: WebGLRenderTarget;
  private rtBloomA!: WebGLRenderTarget;
  private rtBloomB!: WebGLRenderTarget;

  private tier: Tier;
  private readonly lensScale: number;
  private readonly reducedMotion: boolean;

  private width = 1;
  private height = 1;
  private pixelRatio = 1;

  private frameHandle = 0;
  private running = false;

  /** Eased simulation clock, so the disk spins up rather than snapping to speed. */
  private simTime = 0;
  private intro = 0;
  /** performance.now() at first start; 0 until then. */
  private introStart = 0;

  /** Pointer target and its damped follower, both in normalised -1..1 units. */
  private pointerTarget = new Vector2(0, 0);
  private pointer = new Vector2(0, 0);

  private readonly holeWorld = new Vector3(0, 0, 0);
  private readonly projected = new Vector3();
  private readonly right = new Vector3();
  private readonly up = new Vector3();
  private readonly aimTarget = new Vector3();

  /** Where the hole sits in the frame, in NDC. Set from the viewport in resize(). */
  private focusX = 0;
  private focusY = 0;

  constructor(options: BlackHoleOptions) {
    this.reducedMotion = options.reducedMotion ?? false;
    this.lensScale = options.lensScale ?? 1.0;
    this.tier = detectTier();

    this.renderer = new WebGLRenderer({
      canvas: options.canvas,
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false,
      depth: false,
    });
    this.renderer.setClearColor(0x000000, 1);
    // The composite pass encodes sRGB itself, so three must not do it again.
    this.renderer.outputColorSpace = LinearSRGBColorSpace;

    this.camera = new PerspectiveCamera(FOV, 1, 0.1, 500);

    this.disk = new Disk(this.tier.particles);
    this.scene.add(this.disk.object);

    this.stars = createStarfield();

    this.lens = new FullscreenPass(lensFrag, {
      uScene: { value: null },
      uCenter: { value: new Vector2(0.5, 0.5) },
      uAspect: { value: 1 },
      uShadow: { value: 0.13 },
      uLensK: { value: 0.13 },
      uRing: { value: 0.55 },
      uIntro: { value: 0 },
    });

    this.bright = new FullscreenPass(brightFrag, {
      uScene: { value: null },
      uThreshold: { value: 0.55 },
      uKnee: { value: 0.35 },
    });

    this.blur = new FullscreenPass(blurFrag, {
      uScene: { value: null },
      uTexel: { value: new Vector2(1, 1) },
      uDirection: { value: new Vector2(1, 0) },
    });

    this.composite = new FullscreenPass(compositeFrag, {
      uScene: { value: null },
      uBloom: { value: null },
      uBloomIntensity: { value: 1.05 },
      uExposure: { value: 1.05 },
      uTime: { value: 0 },
      uAberration: { value: 0.010 },
      uGrain: { value: 0.012 },
      uVignette: { value: 0.55 },
    });

    this.governor = new QualityGovernor(this.tier, (tier) => this.applyTier(tier));

    this.createTargets();
    this.resize();
  }

  // ---------------------------------------------------------------- lifecycle

  start(): void {
    if (this.reducedMotion) {
      // One frame, fully revealed, at a pleasing point in the orbit.
      this.intro = 1;
      this.simTime = 12;
      this.renderFrame();
      return;
    }
    if (this.running) return;
    this.running = true;
    // Anchored once, so returning to a backgrounded tab resumes rather than
    // replaying the reveal. `clock.start()` resets its own elapsed time, which
    // is exactly what we want for the delta but not for the intro.
    if (this.introStart === 0) this.introStart = performance.now();
    this.clock.start();
    this.loop();
  }

  stop(): void {
    this.running = false;
    if (this.frameHandle) cancelAnimationFrame(this.frameHandle);
    this.frameHandle = 0;
  }

  dispose(): void {
    this.stop();
    this.disk.dispose();
    this.stars.dispose();
    this.lens.dispose();
    this.bright.dispose();
    this.blur.dispose();
    this.composite.dispose();
    this.rtStars.dispose();
    this.rtScene.dispose();
    this.rtBloomA.dispose();
    this.rtBloomB.dispose();
    this.renderer.dispose();
  }

  /** Pointer position in normalised -1..1 coordinates. */
  setPointer(x: number, y: number): void {
    this.pointerTarget.set(x, y);
  }

  // ------------------------------------------------------------------ sizing

  resize(): void {
    const canvas = this.renderer.domElement;
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;

    this.width = w;
    this.height = h;
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, this.tier.maxPixelRatio);

    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h, false);

    this.camera.aspect = w / Math.max(h, 1);
    this.camera.updateProjectionMatrix();

    // Wide viewports put the copy on the left, so the hole moves right of
    // centre. Narrow ones stack copy underneath, so it lifts instead.
    if (w >= 900) {
      this.focusX = 0.36;
      this.focusY = 0.04;
    } else {
      this.focusX = 0;
      this.focusY = 0.34;
    }

    this.resizeTargets();

    if (this.reducedMotion) this.renderFrame();
  }

  private createTargets(): void {
    const opts = {
      type: HalfFloatType,
      format: RGBAFormat,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
    } as const;

    this.rtStars = new WebGLRenderTarget(1, 1, opts);
    this.rtScene = new WebGLRenderTarget(1, 1, opts);
    this.rtBloomA = new WebGLRenderTarget(1, 1, opts);
    this.rtBloomB = new WebGLRenderTarget(1, 1, opts);
  }

  private resizeTargets(): void {
    const scale = this.tier.renderScale;
    const w = Math.max(2, Math.round(this.width * this.pixelRatio * scale));
    const h = Math.max(2, Math.round(this.height * this.pixelRatio * scale));

    this.rtStars.setSize(w, h);
    this.rtScene.setSize(w, h);

    // Bloom runs at half resolution; nobody can tell, and it is the single
    // biggest fill-rate saving available.
    const bw = Math.max(2, Math.round(w / 2));
    const bh = Math.max(2, Math.round(h / 2));
    this.rtBloomA.setSize(bw, bh);
    this.rtBloomB.setSize(bw, bh);

    (this.stars.material.uniforms.uResolution.value as Vector2).set(w, h);
    this.blur.material.uniforms.uTexel.value = new Vector2(1 / bw, 1 / bh);
  }

  private applyTier(tier: Tier): void {
    this.tier = tier;
    this.disk.setCount(tier.particles);
    this.resize();
  }

  // ------------------------------------------------------------------- frame

  private loop = (): void => {
    if (!this.running) return;
    this.frameHandle = requestAnimationFrame(this.loop);

    const dt = Math.min(this.clock.getDelta(), 0.1);
    this.update(dt);
    this.renderFrame();
    this.governor.update(dt);
  };

  private update(dt: number): void {
    // The intro runs on wall-clock rather than accumulated deltas. `dt` is
    // clamped to protect the simulation from tab stalls, and folding that clamp
    // into the reveal would stretch a 2.2s intro into tens of seconds on a
    // device that renders at a few frames per second.
    const elapsed = (performance.now() - this.introStart) / 1000;
    this.intro = Math.min(1, elapsed / INTRO_SECONDS);

    // The spin still integrates clamped deltas, so the orbit stays smooth.
    const spinEase = this.intro * this.intro * (3 - 2 * this.intro);
    this.simTime += dt * spinEase;

    // Critically-damped pointer follow: responsive without the jitter of
    // tracking the raw cursor.
    const k = 1 - Math.exp(-dt * 3.2);
    this.pointer.x += (this.pointerTarget.x - this.pointer.x) * k;
    this.pointer.y += (this.pointerTarget.y - this.pointer.y) * k;
  }

  private updateCamera(): void {
    // Slow autonomous precession keeps the frame alive when nobody is moving
    // the pointer; the pointer adds a bounded offset on top.
    const drift = this.simTime * 0.035;
    const azimuth = drift + this.pointer.x * 0.22;
    const elevation = CAM_ELEVATION + this.pointer.y * 0.10;

    // Dolly in over the intro.
    const distance = CAM_DISTANCE * (1 + 0.35 * (1 - this.intro));

    const cosE = Math.cos(elevation);
    this.camera.position.set(
      Math.sin(azimuth) * cosE * distance,
      Math.sin(elevation) * distance,
      Math.cos(azimuth) * cosE * distance,
    );

    // Aim at the hole first to establish the camera basis …
    this.camera.lookAt(this.holeWorld);
    this.camera.updateMatrixWorld();

    // … then nudge the aim so the hole sits off-centre in the frame. Composing
    // this way rather than translating the hole keeps the world coordinates —
    // and therefore the physics — untouched. On wide screens it moves the disk
    // clear of the copy so both sides of the Doppler asymmetry are visible.
    if (this.focusX !== 0 || this.focusY !== 0) {
      const halfFovTan = Math.tan((FOV * Math.PI) / 360);
      const aspect = this.width / Math.max(this.height, 1);
      this.right.setFromMatrixColumn(this.camera.matrixWorld, 0);
      this.up.setFromMatrixColumn(this.camera.matrixWorld, 1);

      this.aimTarget
        .copy(this.holeWorld)
        .addScaledVector(this.right, -this.focusX * distance * halfFovTan * aspect)
        .addScaledVector(this.up, -this.focusY * distance * halfFovTan);

      this.camera.lookAt(this.aimTarget);
      this.camera.updateMatrixWorld();
    }
  }

  /**
   * Project the hole and its shadow into screen space. Both the lens pass and
   * the disk's vertex shader need these every frame, since the camera moves.
   */
  private updateProjection(): void {
    const aspect = this.width / Math.max(this.height, 1);
    const distance = this.camera.position.distanceTo(this.holeWorld);
    const halfFovTan = Math.tan((FOV * Math.PI) / 360);

    // Shadow radius as a fraction of the NDC half-height.
    const shadowNdc = SHADOW_RADIUS / distance / halfFovTan;

    // Deflection coefficient k, where α(b) = k/b. The textbook weak-field value
    // is k = Rs / (2·tan²(fov/2)·D) in these units, but α = 2Rs/b is only valid
    // far from the hole — near the photon sphere it overshoots badly, and using
    // it verbatim throws the strongly-lensed images out to ~2.8x the shadow
    // radius instead of piling them up just outside it.
    //
    // So k is pinned to where the images should actually land: a source
    // directly behind the hole appears at √k, which we place just outside the
    // photon ring. This also keeps the lensing stable as the camera dollies,
    // since it tracks the shadow rather than the absolute distance.
    const lensK = Math.pow(ARC_RATIO * shadowNdc, 2) * this.lensScale;

    this.projected.copy(this.holeWorld).project(this.camera);
    const centerU = this.projected.x * 0.5 + 0.5;
    const centerV = this.projected.y * 0.5 + 0.5;

    const lensUniforms = this.lens.material.uniforms;
    (lensUniforms.uCenter.value as Vector2).set(centerU, centerV);
    lensUniforms.uAspect.value = aspect;
    // uv-y spans 2 NDC units, so radii halve on the way in — and k, which has
    // units of length² because α = k/b, goes down by the square of that.
    lensUniforms.uShadow.value = shadowNdc / 2;
    lensUniforms.uLensK.value = lensK / 4;
    lensUniforms.uIntro.value = this.intro;

    const diskUniforms = this.disk.material.uniforms;
    diskUniforms.uAspect.value = aspect;
    diskUniforms.uShadowNdc.value = shadowNdc;
    diskUniforms.uLensStrength.value = lensK;
    diskUniforms.uTime.value = this.simTime;
    diskUniforms.uPixelRatio.value = this.pixelRatio;
    diskUniforms.uIntro.value = this.intro;
  }

  private renderFrame(): void {
    this.updateCamera();
    this.updateProjection();

    const starUniforms = this.stars.material.uniforms;
    starUniforms.uTime.value = this.simTime;
    (starUniforms.uParallax.value as Vector2).set(
      this.pointer.x * 0.02,
      this.pointer.y * 0.02,
    );
    starUniforms.uIntensity.value = this.intro;

    // 1. Background starfield.
    this.stars.render(this.renderer, this.rtStars);

    // 2. Bend it around the hole and punch out the shadow.
    this.lens.material.uniforms.uScene.value = this.rtStars.texture;
    this.lens.render(this.renderer, this.rtScene);

    // 3. Accretion disk, additively over the lensed background. Back-side
    //    particles were already displaced around the shadow in the vertex
    //    shader, so no depth buffer is involved.
    this.renderer.autoClear = false;
    this.renderer.setRenderTarget(this.rtScene);
    this.renderer.render(this.scene, this.camera);
    this.renderer.autoClear = true;

    // 4. Bloom: bright-pass, then separable blur ping-pong.
    this.bright.material.uniforms.uScene.value = this.rtScene.texture;
    this.bright.render(this.renderer, this.rtBloomA);

    const blurUniforms = this.blur.material.uniforms;
    for (let i = 0; i < this.tier.bloomIterations; i++) {
      blurUniforms.uScene.value = this.rtBloomA.texture;
      (blurUniforms.uDirection.value as Vector2).set(1 + i, 0);
      this.blur.render(this.renderer, this.rtBloomB);

      blurUniforms.uScene.value = this.rtBloomB.texture;
      (blurUniforms.uDirection.value as Vector2).set(0, 1 + i);
      this.blur.render(this.renderer, this.rtBloomA);
    }

    // 5. Tonemap and present.
    const compUniforms = this.composite.material.uniforms;
    compUniforms.uScene.value = this.rtScene.texture;
    compUniforms.uBloom.value = this.rtBloomA.texture;
    compUniforms.uTime.value = this.simTime;
    this.composite.render(this.renderer, null);

    this.renderer.setRenderTarget(null);
  }

  /** Current tier name — used by the debug overlay. */
  get tierName(): string {
    return this.tier.name;
  }

  get particleCount(): number {
    return this.disk.particleCount;
  }
}
