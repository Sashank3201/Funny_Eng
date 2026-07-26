import {
  AdditiveBlending,
  Clock,
  Color,
  HalfFloatType,
  LinearFilter,
  LinearSRGBColorSpace,
  RGBAFormat,
  Vector2,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';

import { FullscreenPass } from './fullscreen';
import { DISK_SCALE_HEIGHT, ESCAPE_RADIUS, RS, glslPhysicsDefines } from './physics';
import { QualityGovernor, TIERS, detectTier, type Tier, type TierName } from './quality';

import accumulateFrag from './shaders/accumulate.frag.glsl?raw';
import anamorphicFrag from './shaders/anamorphic.frag.glsl?raw';
import brightFrag from './shaders/bright.frag.glsl?raw';
import compositeFrag from './shaders/composite.frag.glsl?raw';
import diskChunk from './shaders/disk.glsl?raw';
import downsampleFrag from './shaders/downsample.frag.glsl?raw';
import geodesicFrag from './shaders/geodesic.frag.glsl?raw';
import jetChunk from './shaders/jet.glsl?raw';
import noiseChunk from './shaders/noise.glsl?raw';
import skyChunk from './shaders/sky.glsl?raw';
import upsampleFrag from './shaders/upsample.frag.glsl?raw';

export const FOV = 40;

/** Duration of the opening move. */
const INTRO_SECONDS = 3.6;

/** Accumulation weight when the camera is at rest. Lower converges further. */
const TAA_BLEND = 0.10;

/**
 * A camera pose, in the hole's frame. The scroll choreography produces these;
 * the renderer turns them into a basis.
 */
export interface CameraState {
  /** Distance from the hole, in Rs. */
  distance: number;
  /** Orbital angle about the spin axis, radians. */
  azimuth: number;
  /** Angle above the disk plane, radians. Near zero is near edge-on. */
  elevation: number;
  /** Where the hole sits in the frame, in NDC. */
  focusX: number;
  focusY: number;
}

export interface GeodesicOptions {
  canvas: HTMLCanvasElement;
  reducedMotion?: boolean;
  /** Override tier detection. Used by the physics self-test, which needs a
   *  known march resolution and step count to measure against. */
  forceTier?: TierName;
  /** Override the integration step count, for convergence testing. */
  stepOverride?: number;
}

/** Halton low-discrepancy sequence — the jitter pattern for temporal AA. */
function halton(index: number, base: number): number {
  let f = 1;
  let r = 0;
  let i = index;
  while (i > 0) {
    f /= base;
    r += f * (i % base);
    i = Math.floor(i / base);
  }
  return r;
}

export class GeodesicRenderer {
  private readonly renderer: WebGLRenderer;
  private readonly clock = new Clock();
  private readonly governor: QualityGovernor;

  private geodesic!: FullscreenPass;
  private readonly accumulate: FullscreenPass;
  private readonly bright: FullscreenPass;
  private readonly downsample: FullscreenPass;
  private readonly upsample: FullscreenPass;
  private readonly anamorphic: FullscreenPass;
  private readonly composite: FullscreenPass;

  private rtRay!: WebGLRenderTarget;
  private rtHistory!: [WebGLRenderTarget, WebGLRenderTarget];
  private historyIndex = 0;
  private bloomMips: WebGLRenderTarget[] = [];
  private rtStreak!: WebGLRenderTarget;

  private tier: Tier;
  private readonly tierLocked: boolean = false;
  private readonly reducedMotion: boolean;

  private width = 1;
  private height = 1;
  private pixelRatio = 1;
  private rayWidth = 1;
  private rayHeight = 1;

  private frameHandle = 0;
  private running = false;
  private frameIndex = 0;
  private historyDirty = true;

  private simTime = 0;
  private intro = 0;
  private introStart = 0;

  /** Target pose from the choreography, and the damped pose actually used. */
  private target: CameraState = {
    distance: 30 * RS,
    azimuth: 0,
    elevation: 0.22,
    focusX: 0,
    focusY: 0,
  };
  private current: CameraState = { ...this.target };
  private poseInitialised = false;

  private readonly camPos = new Vector3();
  private readonly camFwd = new Vector3();
  private readonly camRight = new Vector3();
  private readonly camUp = new Vector3();
  private readonly prevCamPos = new Vector3();
  private camSpeed = 0;
  /** Diagnostic mode freezes the idle motion so measurements are repeatable. */
  private diagnostic = false;

  constructor(options: GeodesicOptions) {
    this.reducedMotion = options.reducedMotion ?? false;
    this.tier = options.forceTier ? TIERS[options.forceTier] : detectTier();
    this.tierLocked = Boolean(options.forceTier);
    if (options.stepOverride) {
      this.tier = { ...this.tier, maxSteps: options.stepOverride };
    }

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

    this.accumulate = new FullscreenPass(accumulateFrag, {
      uCurrent: { value: null },
      uHistory: { value: null },
      uBlend: { value: 1 },
    });

    this.bright = new FullscreenPass(brightFrag, {
      uScene: { value: null },
      uThreshold: { value: 0.62 },
      uKnee: { value: 0.4 },
    });

    this.downsample = new FullscreenPass(downsampleFrag, {
      uScene: { value: null },
      uTexel: { value: new Vector2(1, 1) },
    });

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
      uBloomIntensity: { value: 0.34 },
      uStreakIntensity: { value: 0.18 },
      uHalation: { value: 0.12 },
      uExposure: { value: 1.15 },
      uTime: { value: 0 },
      uAberration: { value: 0.008 },
      uGrain: { value: 0.012 },
      uVignette: { value: 0.48 },
      uContrast: { value: 0.2 },
      uSaturation: { value: 1.22 },
      uShadowTint: { value: new Color(0.9, 0.95, 1.07) },
      uHighlightTint: { value: new Color(1.06, 0.99, 0.92) },
    });

    this.buildGeodesicPass();
    this.governor = new QualityGovernor(this.tier, (tier) => this.applyTier(tier));

    this.createTargets();
    this.resize();
  }

  /**
   * The march is compiled per tier: step count and angular step are #defines so
   * the loop bound is a constant, which is what lets the driver generate decent
   * code for it. Changing tier therefore rebuilds this pass.
   */
  private buildGeodesicPass(): void {
    const defines = [
      glslPhysicsDefines(),
      `#define MAX_STEPS ${this.tier.maxSteps}`,
      `#define DPHI_MAX ${this.tier.maxStepAngle.toFixed(4)}`,
      '#define PI 3.14159265359',
      '',
    ].join('\n');

    const source = defines + noiseChunk + skyChunk + diskChunk + jetChunk + geodesicFrag;

    const previous = this.geodesic;
    this.geodesic = new FullscreenPass(source, {
      uCamPos: { value: new Vector3() },
      uCamRight: { value: new Vector3() },
      uCamUp: { value: new Vector3() },
      uCamFwd: { value: new Vector3() },
      uResolution: { value: new Vector2(1, 1) },
      uTanHalfFov: { value: Math.tan((FOV * Math.PI) / 360) },
      uJitter: { value: new Vector2() },
      uSkyBrightness: { value: 1.0 },
      uIntro: { value: 0 },
      uJetOn: { value: this.tier.jets ? 1 : 0 },
      uFlatSky: { value: 0 },
      uTime: { value: 0 },
      uDiskTemp: { value: 4400 },
      uDiskBrightness: { value: 2.6 },
      uDiskOpacity: { value: 0.85 },
      uDiskHR: { value: DISK_SCALE_HEIGHT },
      uDiskSpin: { value: 1 },
      uJetBrightness: { value: 0.22 },
      uJetLength: { value: 26 * RS },
    });
    previous?.dispose();
  }

  // ---------------------------------------------------------------- lifecycle

  start(): void {
    if (this.reducedMotion) {
      this.intro = 1;
      this.simTime = 30;
      this.historyDirty = true;
      this.renderFrame(1 / 60);
      return;
    }
    if (this.running) return;
    this.running = true;
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
    this.geodesic.dispose();
    this.accumulate.dispose();
    this.bright.dispose();
    this.downsample.dispose();
    this.upsample.dispose();
    this.anamorphic.dispose();
    this.composite.dispose();
    this.rtRay.dispose();
    this.rtHistory[0].dispose();
    this.rtHistory[1].dispose();
    this.rtStreak.dispose();
    for (const mip of this.bloomMips) mip.dispose();
    this.renderer.dispose();
  }

  /** Set the pose the camera should ease toward. */
  setCamera(state: CameraState): void {
    this.target = state;
    if (this.diagnostic) this.current = { ...state };
    if (!this.poseInitialised) {
      this.current = { ...state };
      this.poseInitialised = true;
    }
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

    this.resizeTargets();
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
    this.rtRay = new WebGLRenderTarget(1, 1, opts);
    this.rtHistory = [
      new WebGLRenderTarget(1, 1, opts),
      new WebGLRenderTarget(1, 1, opts),
    ];
    this.rtStreak = new WebGLRenderTarget(1, 1, opts);
  }

  private resizeTargets(): void {
    const rw = Math.max(2, Math.round(this.width * this.pixelRatio * this.tier.rayScale));
    const rh = Math.max(2, Math.round(this.height * this.pixelRatio * this.tier.rayScale));
    this.rayWidth = rw;
    this.rayHeight = rh;

    this.rtRay.setSize(rw, rh);
    this.rtHistory[0].setSize(rw, rh);
    this.rtHistory[1].setSize(rw, rh);

    const levels = this.tier.bloomLevels;
    if (this.bloomMips.length !== levels) {
      for (const mip of this.bloomMips) mip.dispose();
      this.bloomMips = Array.from(
        { length: levels },
        () => new WebGLRenderTarget(1, 1, this.targetOptions()),
      );
    }
    let mw = rw;
    let mh = rh;
    for (const mip of this.bloomMips) {
      mw = Math.max(2, Math.floor(mw / 2));
      mh = Math.max(2, Math.floor(mh / 2));
      mip.setSize(mw, mh);
    }

    this.rtStreak.setSize(Math.max(2, Math.floor(rw / 4)), Math.max(2, Math.floor(rh / 4)));
    (this.geodesic.material.uniforms.uResolution.value as Vector2).set(rw, rh);
  }

  private applyTier(tier: Tier): void {
    if (this.tierLocked) return;
    this.tier = tier;
    this.buildGeodesicPass();
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
    // Wall-clock, so a slow device or a backgrounded tab does not stretch or
    // replay the opening move.
    const elapsed = (performance.now() - this.introStart) / 1000;
    this.intro = Math.min(1, elapsed / INTRO_SECONDS);

    this.simTime += dt;

    // Critically-damped follow toward the choreographed pose. Every transition
    // in the page — scroll, pointer, intro — arrives through this one filter,
    // which is what keeps the motion continuous instead of stepped.
    const k = 1 - Math.exp(-dt * 2.6);
    const c = this.current;
    const t = this.target;
    c.distance += (t.distance - c.distance) * k;
    c.azimuth += (t.azimuth - c.azimuth) * k;
    c.elevation += (t.elevation - c.elevation) * k;
    c.focusX += (t.focusX - c.focusX) * k;
    c.focusY += (t.focusY - c.focusY) * k;
  }

  private updateCamera(dt: number): void {
    const c = this.current;

    // Ease the opening dolly with a cubic, and let the curvature come up with
    // it so the hole appears to switch on rather than pop in.
    const introEase = 1 - Math.pow(1 - this.intro, 3);
    const distance = c.distance * (1 + 1.1 * (1 - introEase));

    // A slow breath and a touch of drift keep the frame alive at rest.
    const breathe = this.diagnostic ? 1 : 1 + 0.015 * Math.sin(this.simTime * 0.19);
    const driftAz = this.diagnostic ? 0 : Math.sin(this.simTime * 0.047) * 0.03;
    const driftEl = this.diagnostic ? 0 : Math.cos(this.simTime * 0.031) * 0.015;

    const az = c.azimuth + driftAz;
    const el = c.elevation + driftEl;
    const d = distance * breathe;

    this.prevCamPos.copy(this.camPos);
    this.camPos.set(
      Math.sin(az) * Math.cos(el) * d,
      Math.sin(el) * d,
      Math.cos(az) * Math.cos(el) * d,
    );

    if (dt > 0) {
      this.camSpeed = this.prevCamPos.distanceTo(this.camPos) / Math.max(d, 1e-3) / dt;
    }

    // Look at the hole, then swing the aim so it sits off-centre. Offsetting
    // the aim rather than moving the hole leaves world coordinates — and so the
    // physics — untouched.
    this.camFwd.copy(this.camPos).multiplyScalar(-1).normalize();
    const worldUp = new Vector3(0, 1, 0);
    this.camRight.crossVectors(this.camFwd, worldUp).normalize();
    this.camUp.crossVectors(this.camRight, this.camFwd).normalize();

    const tanHalf = Math.tan((FOV * Math.PI) / 360);
    const aspect = this.width / Math.max(this.height, 1);
    this.camFwd
      .addScaledVector(this.camRight, -c.focusX * tanHalf * aspect)
      .addScaledVector(this.camUp, -c.focusY * tanHalf)
      .normalize();
    this.camRight.crossVectors(this.camFwd, worldUp).normalize();
    this.camUp.crossVectors(this.camRight, this.camFwd).normalize();
  }

  private renderBloom(source: WebGLRenderTarget): void {
    const mips = this.bloomMips;

    this.bright.material.uniforms.uScene.value = source.texture;
    this.bright.render(this.renderer, mips[0]);

    const down = this.downsample.material.uniforms;
    for (let i = 1; i < mips.length; i++) {
      const src = mips[i - 1];
      down.uScene.value = src.texture;
      (down.uTexel.value as Vector2).set(1 / src.width, 1 / src.height);
      this.downsample.render(this.renderer, mips[i]);
    }

    const up = this.upsample.material.uniforms;
    for (let i = mips.length - 1; i > 0; i--) {
      const src = mips[i];
      up.uScene.value = src.texture;
      (up.uTexel.value as Vector2).set(1 / src.width, 1 / src.height);
      this.upsample.render(this.renderer, mips[i - 1], false);
    }

    const streakSrc = mips[Math.min(1, mips.length - 1)];
    const ana = this.anamorphic.material.uniforms;
    ana.uScene.value = streakSrc.texture;
    (ana.uTexel.value as Vector2).set(1 / streakSrc.width, 1 / streakSrc.height);
    this.anamorphic.render(this.renderer, this.rtStreak);
  }

  private renderFrame(dt: number): void {
    this.updateCamera(dt);

    const u = this.geodesic.material.uniforms;
    (u.uCamPos.value as Vector3).copy(this.camPos);
    (u.uCamRight.value as Vector3).copy(this.camRight);
    (u.uCamUp.value as Vector3).copy(this.camUp);
    (u.uCamFwd.value as Vector3).copy(this.camFwd);
    u.uTime.value = this.simTime;
    u.uIntro.value = this.intro;

    // Sub-pixel jitter on a Halton sequence. Combined with the accumulation
    // below this is what recovers detail lost to marching at a fraction of
    // native resolution — the frames converge on the fully sampled image.
    const j = this.frameIndex % 16;
    (u.uJitter.value as Vector2).set(halton(j + 1, 2) - 0.5, halton(j + 1, 3) - 0.5);

    // 1. March the geodesics.
    this.geodesic.render(this.renderer, this.rtRay);

    // 2. Converge.
    const target = this.rtHistory[this.historyIndex];
    const source = this.rtHistory[1 - this.historyIndex];

    let blend = 1;
    if (!this.reducedMotion && !this.historyDirty) {
      // Distance is constant across the page now, so the camera moves less and
      // the history stays valid longer. Holding the blend lower trades a
      // little ghosting for a much steadier picture mid-scroll, which is
      // exactly when the noise was most visible.
      const base = Math.min(0.55, TAA_BLEND + this.camSpeed * 1.2);
      blend = 1 - Math.pow(1 - base, Math.max(dt, 1e-4) * 60);
    }
    this.historyDirty = false;

    const acc = this.accumulate.material.uniforms;
    acc.uCurrent.value = this.rtRay.texture;
    acc.uHistory.value = source.texture;
    acc.uBlend.value = blend;
    this.accumulate.render(this.renderer, target);
    this.historyIndex = 1 - this.historyIndex;

    // 3. Bloom and streak.
    this.renderBloom(target);

    // 4. Grade and present, upscaling to the canvas on the way.
    const comp = this.composite.material.uniforms;
    comp.uScene.value = target.texture;
    comp.uBloom.value = this.bloomMips[0].texture;
    comp.uStreak.value = this.rtStreak.texture;
    comp.uTime.value = this.simTime;
    this.composite.render(this.renderer, null);

    this.renderer.setRenderTarget(null);
    this.frameIndex++;
  }

  // ------------------------------------------------------------------ probes

  /** Exposed for the physics self-test and for tuning in devtools. */
  get tierName(): string {
    return this.tier.name;
  }

  get raySize(): { width: number; height: number } {
    return { width: this.rayWidth, height: this.rayHeight };
  }

  get escapeRadius(): number {
    return ESCAPE_RADIUS;
  }

  /** Current camera distance from the hole, in Rs. Used by the shadow test. */
  get cameraDistance(): number {
    return this.camPos.length();
  }

  get fieldOfView(): number {
    return FOV;
  }

  /** Turn the disk and jets off so the shadow's silhouette can be measured. */
  setFeatures(disk: boolean, jets: boolean): void {
    const u = this.geodesic.material.uniforms;
    u.uDiskBrightness.value = disk ? 2.6 : 0;
    // Opacity has to go too. Zeroing only the emission would leave invisible
    // gas still absorbing, and the shadow test would measure that rather than
    // the silhouette.
    u.uDiskOpacity.value = disk ? 0.85 : 0;
    u.uJetOn.value = jets && this.tier.jets ? 1 : 0;
    this.historyDirty = true;
  }

  /**
   * Strip the grade down to a flat, measurable image: no grain, no vignette,
   * no aberration, no bloom, and a bright sky. The physics self-test measures
   * the shadow's silhouette in pixels, and every one of those effects would
   * blur or bias the edge it is looking for.
   */
  setDiagnostic(enabled: boolean): void {
    this.diagnostic = enabled;
    this.geodesic.material.uniforms.uFlatSky.value = enabled ? 1 : 0;
    const c = this.composite.material.uniforms;
    c.uGrain.value = enabled ? 0 : 0.012;
    c.uVignette.value = enabled ? 0 : 0.48;
    c.uAberration.value = enabled ? 0 : 0.008;
    c.uBloomIntensity.value = enabled ? 0 : 0.34;
    c.uStreakIntensity.value = enabled ? 0 : 0.18;
    c.uHalation.value = enabled ? 0 : 0.12;
    c.uContrast.value = enabled ? 0 : 0.2;
    c.uExposure.value = enabled ? 1.0 : 1.15;
    this.geodesic.material.uniforms.uSkyBrightness.value = enabled ? 6.0 : 1.0;
    this.historyDirty = true;
  }

  /**
   * Isolate the disk so its vertical profile can be measured: no sky, no
   * glare, no grade, and optically thin — so what reaches the camera is pure
   * emission rather than a saturated slab, whose width would say more about
   * the opacity than about the scale height.
   */
  setDiskProbe(enabled: boolean): void {
    this.diagnostic = enabled;
    const c = this.composite.material.uniforms;
    const g = this.geodesic.material.uniforms;

    c.uGrain.value = enabled ? 0 : 0.012;
    c.uVignette.value = enabled ? 0 : 0.48;
    c.uAberration.value = enabled ? 0 : 0.008;
    c.uBloomIntensity.value = enabled ? 0 : 0.34;
    c.uStreakIntensity.value = enabled ? 0 : 0.18;
    c.uHalation.value = enabled ? 0 : 0.12;
    c.uContrast.value = enabled ? 0 : 0.2;
    c.uSaturation.value = enabled ? 1 : 1.22;
    c.uExposure.value = enabled ? 1 : 1.15;

    g.uFlatSky.value = 0;
    g.uSkyBrightness.value = enabled ? 0 : 1;
    g.uJetOn.value = enabled ? 0 : (this.tier.jets ? 1 : 0);
    g.uDiskOpacity.value = enabled ? 0.02 : 0.85;
    g.uDiskBrightness.value = 2.6;
    this.historyDirty = true;
  }

  /** Override the disk scale height. Used by the thickness test. */
  setScaleHeight(hr: number): void {
    this.geodesic.material.uniforms.uDiskHR.value = hr;
    this.historyDirty = true;
  }

  /** Freeze the intro so `mass` is at its full value during measurement. */
  completeIntro(): void {
    this.introStart = performance.now() - INTRO_SECONDS * 1000 * 2;
    this.intro = 1;
  }
}
