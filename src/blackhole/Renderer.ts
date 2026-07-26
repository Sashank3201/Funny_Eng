import {
  AdditiveBlending,
  Clock,
  Color,
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
import { Jet } from './Jet';
import { FullscreenPass } from './fullscreen';
import { RS, SHADOW_RADIUS } from './physics';
import { createStarfield } from './Starfield';
import { QualityGovernor, detectTier, type Tier } from './quality';

import accumulateFrag from './shaders/accumulate.frag.glsl?raw';
import anamorphicFrag from './shaders/anamorphic.frag.glsl?raw';
import brightFrag from './shaders/bright.frag.glsl?raw';
import combineFrag from './shaders/combine.frag.glsl?raw';
import compositeFrag from './shaders/composite.frag.glsl?raw';
import downsampleFrag from './shaders/downsample.frag.glsl?raw';
import lensFrag from './shaders/lens.frag.glsl?raw';
import upsampleFrag from './shaders/upsample.frag.glsl?raw';

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
const INTRO_SECONDS = 3.4;

/** Trail length when the camera is at rest. Lower is longer. */
const TRAIL_BLEND = 0.16;

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
  private readonly jet: Jet;
  private readonly stars: FullscreenPass;
  private readonly lens: FullscreenPass;
  private readonly accumulate: FullscreenPass;
  private readonly combine: FullscreenPass;
  private readonly bright: FullscreenPass;
  private readonly downsample: FullscreenPass;
  private readonly upsample: FullscreenPass;
  private readonly anamorphic: FullscreenPass;
  private readonly composite: FullscreenPass;
  private readonly governor: QualityGovernor;

  private rtStars!: WebGLRenderTarget;
  private rtBg!: WebGLRenderTarget;
  private rtEmissive!: WebGLRenderTarget;
  /** Ping-pong pair holding the temporally accumulated emissive layer. */
  private rtHistory!: [WebGLRenderTarget, WebGLRenderTarget];
  private historyIndex = 0;
  private rtScene!: WebGLRenderTarget;
  private bloomMips: WebGLRenderTarget[] = [];
  private rtStreak!: WebGLRenderTarget;

  private tier: Tier;
  private readonly lensScale: number;
  private readonly reducedMotion: boolean;

  private width = 1;
  private height = 1;
  private pixelRatio = 1;

  private frameHandle = 0;
  private running = false;
  private frameIndex = 0;
  /** Set when the accumulation history is stale and must be overwritten. */
  private historyDirty = true;

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
  private readonly prevCamPos = new Vector3();
  /** Camera angular speed, rad/s, driving the trail-length adaptation. */
  private camSpeed = 0;

  /** The starfield is cached; these track when it needs redrawing. */
  private readonly lastStarParallax = new Vector2(999, 999);
  private starsDirty = true;

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
    this.jet = new Jet(this.tier.jetParticles);
    this.scene.add(this.disk.object);
    this.scene.add(this.jet.object);

    this.stars = createStarfield();

    this.lens = new FullscreenPass(lensFrag, {
      uScene: { value: null },
      uCenter: { value: new Vector2(0.5, 0.5) },
      uAspect: { value: 1 },
      uShadow: { value: 0.13 },
      uLensK: { value: 0.13 },
      uRing: { value: 0.85 },
      uIntro: { value: 0 },
    });

    this.accumulate = new FullscreenPass(accumulateFrag, {
      uCurrent: { value: null },
      uHistory: { value: null },
      uBlend: { value: 1 },
    });

    this.combine = new FullscreenPass(combineFrag, {
      uBackground: { value: null },
      uEmissive: { value: null },
    });

    this.bright = new FullscreenPass(brightFrag, {
      uScene: { value: null },
      uThreshold: { value: 0.72 },
      uKnee: { value: 0.35 },
    });

    this.downsample = new FullscreenPass(downsampleFrag, {
      uScene: { value: null },
      uTexel: { value: new Vector2(1, 1) },
    });

    // Upsample blends additively into the mip above it.
    this.upsample = new FullscreenPass(
      upsampleFrag,
      {
        uScene: { value: null },
        uTexel: { value: new Vector2(1, 1) },
        uRadius: { value: 1.0 },
      },
      AdditiveBlending,
    );

    this.anamorphic = new FullscreenPass(anamorphicFrag, {
      uScene: { value: null },
      uTexel: { value: new Vector2(1, 1) },
      uWidth: { value: 5.0 },
    });

    this.composite = new FullscreenPass(compositeFrag, {
      uScene: { value: null },
      uBloom: { value: null },
      uStreak: { value: null },
      uBloomIntensity: { value: 0.40 },
      uStreakIntensity: { value: 0.22 },
      uHalation: { value: 0.14 },
      uExposure: { value: 1.05 },
      uTime: { value: 0 },
      uAberration: { value: 0.012 },
      uGrain: { value: 0.014 },
      uVignette: { value: 0.55 },
      uContrast: { value: 0.22 },
      uShadowTint: { value: new Color(0.90, 0.95, 1.06) },
      uHighlightTint: { value: new Color(1.05, 0.99, 0.93) },
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
      this.simTime = 26;
      this.historyDirty = true;
      this.starsDirty = true;
      this.renderFrame(1 / 60);
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
    this.jet.dispose();
    this.stars.dispose();
    this.lens.dispose();
    this.accumulate.dispose();
    this.combine.dispose();
    this.bright.dispose();
    this.downsample.dispose();
    this.upsample.dispose();
    this.anamorphic.dispose();
    this.composite.dispose();
    this.rtStars.dispose();
    this.rtBg.dispose();
    this.rtEmissive.dispose();
    this.rtHistory[0].dispose();
    this.rtHistory[1].dispose();
    this.rtScene.dispose();
    this.rtStreak.dispose();
    for (const mip of this.bloomMips) mip.dispose();
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
    this.starsDirty = true;
    this.historyDirty = true;

    if (this.reducedMotion) this.renderFrame(1 / 60);
  }

  private targetOptions() {
    return {
      type: HalfFloatType,
      format: RGBAFormat,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
    } as const;
  }

  private createTargets(): void {
    const opts = this.targetOptions();
    this.rtStars = new WebGLRenderTarget(1, 1, opts);
    this.rtBg = new WebGLRenderTarget(1, 1, opts);
    this.rtEmissive = new WebGLRenderTarget(1, 1, opts);
    this.rtHistory = [
      new WebGLRenderTarget(1, 1, opts),
      new WebGLRenderTarget(1, 1, opts),
    ];
    this.rtScene = new WebGLRenderTarget(1, 1, opts);
    this.rtStreak = new WebGLRenderTarget(1, 1, opts);
  }

  private resizeTargets(): void {
    const scale = this.tier.renderScale;
    const w = Math.max(2, Math.round(this.width * this.pixelRatio * scale));
    const h = Math.max(2, Math.round(this.height * this.pixelRatio * scale));

    this.rtStars.setSize(w, h);
    this.rtBg.setSize(w, h);
    this.rtEmissive.setSize(w, h);
    this.rtHistory[0].setSize(w, h);
    this.rtHistory[1].setSize(w, h);
    this.rtScene.setSize(w, h);

    // Bloom pyramid: each level half the one above, starting at half the scene.
    const levels = this.tier.bloomLevels;
    if (this.bloomMips.length !== levels) {
      for (const mip of this.bloomMips) mip.dispose();
      this.bloomMips = Array.from(
        { length: levels },
        () => new WebGLRenderTarget(1, 1, this.targetOptions()),
      );
    }
    let mw = w;
    let mh = h;
    for (const mip of this.bloomMips) {
      mw = Math.max(2, Math.floor(mw / 2));
      mh = Math.max(2, Math.floor(mh / 2));
      mip.setSize(mw, mh);
    }

    this.rtStreak.setSize(
      Math.max(2, Math.floor(w / 4)),
      Math.max(2, Math.floor(h / 4)),
    );

    const res = new Vector2(w, h);
    (this.stars.material.uniforms.uResolution.value as Vector2).copy(res);
    (this.disk.material.uniforms.uResolution.value as Vector2).copy(res);
    (this.jet.material.uniforms.uResolution.value as Vector2).copy(res);
  }

  private applyTier(tier: Tier): void {
    this.tier = tier;
    this.disk.setCount(tier.particles);
    this.jet.setCount(tier.jetParticles);
    this.resize();
  }

  // ------------------------------------------------------------------- frame

  private loop = (): void => {
    if (!this.running) return;
    this.frameHandle = requestAnimationFrame(this.loop);

    const dt = Math.min(this.clock.getDelta(), 0.1);
    this.update(dt);
    this.renderFrame(dt);
    this.governor.update(dt);
  };

  private update(dt: number): void {
    // The intro runs on wall-clock rather than accumulated deltas. `dt` is
    // clamped to protect the simulation from tab stalls, and folding that clamp
    // into the reveal would stretch the intro into tens of seconds on a device
    // that renders at a few frames per second.
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

  private updateCamera(dt: number): void {
    // Slow autonomous precession keeps the frame alive when nobody is moving
    // the pointer; the pointer adds a bounded offset on top.
    const drift = this.simTime * 0.035;
    const t = this.simTime;

    // Very low-amplitude drift on top of everything, so the frame breathes
    // rather than sitting on rails. Layered sines at incommensurate periods
    // never visibly repeat and cost nothing.
    const handheldX = Math.sin(t * 0.23) * 0.012 + Math.sin(t * 0.61) * 0.005;
    const handheldY = Math.cos(t * 0.19) * 0.010 + Math.cos(t * 0.47) * 0.004;

    const azimuth = drift + this.pointer.x * 0.22 + handheldX;
    const elevation = CAM_ELEVATION + this.pointer.y * 0.10 + handheldY;

    // Dolly in over the intro, then breathe.
    const breathe = 1 + 0.02 * Math.sin(t * 0.21);
    const introEase = 1 - Math.pow(1 - this.intro, 3);
    const distance = CAM_DISTANCE * breathe * (1 + 0.45 * (1 - introEase));

    const cosE = Math.cos(elevation);
    this.prevCamPos.copy(this.camera.position);
    this.camera.position.set(
      Math.sin(azimuth) * cosE * distance,
      Math.sin(elevation) * distance,
      Math.cos(azimuth) * cosE * distance,
    );

    // Angular speed of the camera about the hole, used to shorten the motion
    // trails while it moves.
    if (dt > 0) {
      const moved = this.prevCamPos.distanceTo(this.camera.position);
      this.camSpeed = moved / Math.max(distance, 1e-3) / dt;
    }

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
   * Project the hole and its shadow into screen space. The lens pass and both
   * particle shaders need these every frame, since the camera moves.
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
    //
    // Easing it in over the intro makes the hole appear to "switch on".
    const lensK = Math.pow(ARC_RATIO * shadowNdc, 2) * this.lensScale * this.intro;

    this.projected.copy(this.holeWorld).project(this.camera);

    const lensUniforms = this.lens.material.uniforms;
    (lensUniforms.uCenter.value as Vector2).set(
      this.projected.x * 0.5 + 0.5,
      this.projected.y * 0.5 + 0.5,
    );
    lensUniforms.uAspect.value = aspect;
    // uv-y spans 2 NDC units, so radii halve on the way in — and k, which has
    // units of length² because α = k/b, goes down by the square of that.
    lensUniforms.uShadow.value = shadowNdc / 2;
    lensUniforms.uLensK.value = lensK / 4;
    lensUniforms.uIntro.value = this.intro;

    for (const material of [this.disk.material, this.jet.material]) {
      const u = material.uniforms;
      u.uAspect.value = aspect;
      u.uShadowNdc.value = shadowNdc;
      u.uLensStrength.value = lensK;
      u.uTime.value = this.simTime;
      u.uIntro.value = this.intro;
    }
  }

  /** The starfield does not depend on the camera, so it is only redrawn when
   *  the parallax has actually moved or the twinkle needs a step. */
  private updateStarfield(): void {
    const px = this.pointer.x * 0.02;
    const py = this.pointer.y * 0.02;

    const moved =
      Math.abs(px - this.lastStarParallax.x) + Math.abs(py - this.lastStarParallax.y);
    // A slow twinkle does not need 60Hz.
    const twinkleDue = this.frameIndex % 6 === 0;

    if (!this.starsDirty && !twinkleDue && moved < 0.0004) return;

    const u = this.stars.material.uniforms;
    u.uTime.value = this.simTime;
    (u.uParallax.value as Vector2).set(px, py);
    u.uIntensity.value = this.intro;
    this.lastStarParallax.set(px, py);
    this.starsDirty = false;

    this.stars.render(this.renderer, this.rtStars);
  }

  private renderBloom(): void {
    const mips = this.bloomMips;

    // Bright-pass into the first (half-resolution) mip.
    this.bright.material.uniforms.uScene.value = this.rtScene.texture;
    this.bright.render(this.renderer, mips[0]);

    // Down the pyramid.
    const down = this.downsample.material.uniforms;
    for (let i = 1; i < mips.length; i++) {
      const src = mips[i - 1];
      down.uScene.value = src.texture;
      (down.uTexel.value as Vector2).set(1 / src.width, 1 / src.height);
      this.downsample.render(this.renderer, mips[i]);
    }

    // Back up, blending additively into the larger mip each step.
    const up = this.upsample.material.uniforms;
    for (let i = mips.length - 1; i > 0; i--) {
      const src = mips[i];
      up.uScene.value = src.texture;
      (up.uTexel.value as Vector2).set(1 / src.width, 1 / src.height);
      this.upsample.render(this.renderer, mips[i - 1], false);
    }

    // Anamorphic streak from a mid mip, which is already wide and smooth.
    const streakSrc = mips[Math.min(1, mips.length - 1)];
    const ana = this.anamorphic.material.uniforms;
    ana.uScene.value = streakSrc.texture;
    (ana.uTexel.value as Vector2).set(1 / streakSrc.width, 1 / streakSrc.height);
    this.anamorphic.render(this.renderer, this.rtStreak);
  }

  private renderFrame(dt: number): void {
    this.updateCamera(dt);
    this.updateProjection();

    // 1. Background starfield (cached).
    this.updateStarfield();

    // 2. Bend it around the hole and punch out the shadow.
    this.lens.material.uniforms.uScene.value = this.rtStars.texture;
    this.lens.render(this.renderer, this.rtBg);

    // 3. Disk and jets into their own buffer. Back-side particles were already
    //    displaced around the shadow in the vertex shader, so no depth buffer
    //    is involved.
    this.renderer.setRenderTarget(this.rtEmissive);
    this.renderer.clear(true, false, false);
    this.renderer.render(this.scene, this.camera);

    // 4. Accumulate that layer over time — this is the motion blur that turns
    //    discrete particles into flowing light. The blend rises with camera
    //    speed so trails follow the orbit, not the camera.
    const target = this.rtHistory[this.historyIndex];
    const source = this.rtHistory[1 - this.historyIndex];

    let blend = 1;
    if (!this.reducedMotion && !this.historyDirty) {
      const base = Math.min(0.92, TRAIL_BLEND + this.camSpeed * 0.6);
      // Frame-rate compensation, so trail length is constant in time rather
      // than in frames.
      blend = 1 - Math.pow(1 - base, Math.max(dt, 1e-4) * 60);
    }
    this.historyDirty = false;

    const acc = this.accumulate.material.uniforms;
    acc.uCurrent.value = this.rtEmissive.texture;
    acc.uHistory.value = source.texture;
    acc.uBlend.value = blend;
    this.accumulate.render(this.renderer, target);
    this.historyIndex = 1 - this.historyIndex;

    // 5. Background plus the accumulated emissive layer.
    const comb = this.combine.material.uniforms;
    comb.uBackground.value = this.rtBg.texture;
    comb.uEmissive.value = target.texture;
    this.combine.render(this.renderer, this.rtScene);

    // 6. Bloom pyramid and anamorphic streak.
    this.renderBloom();

    // 7. Tonemap, grade and present.
    const compUniforms = this.composite.material.uniforms;
    compUniforms.uScene.value = this.rtScene.texture;
    compUniforms.uBloom.value = this.bloomMips[0].texture;
    compUniforms.uStreak.value = this.rtStreak.texture;
    compUniforms.uTime.value = this.simTime;
    this.composite.render(this.renderer, null);

    this.renderer.setRenderTarget(null);
    this.frameIndex++;
  }

  /** Current tier name — used by the debug overlay and the glass perf guard. */
  get tierName(): string {
    return this.tier.name;
  }

  get particleCount(): number {
    return this.disk.particleCount;
  }
}
