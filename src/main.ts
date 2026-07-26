import './styles/main.css';

import { GeodesicRenderer } from './blackhole/GeodesicRenderer';
import type { CameraState } from './blackhole/GeodesicRenderer';
import type { TierName } from './blackhole/quality';
import { content } from './content';
import { KEYFRAMES, adaptForNarrow, applyPointer, poseForProgress } from './scroll/choreography';
import { activeSection, mountNav, setCameraHooks, updateNav } from './ui/nav';
import { observeReveals, renderChrome, renderSections } from './ui/sections';

function supportsWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

/** Document scroll progress, 0..1. */
function scrollProgress(): number {
  const max = document.documentElement.scrollHeight - window.innerHeight;
  if (max <= 0) return 0;
  return Math.min(1, Math.max(0, window.scrollY / max));
}

function applyMeta(): void {
  document.title = `${content.meta.name} — ${content.meta.role}`;
  const description = document.querySelector('meta[name="description"]');
  if (description) description.setAttribute('content', content.meta.description);
}

/** `?tier=high|medium|low|floor` pins quality — used by the physics self-test,
 *  which needs a known march resolution to measure against, and as the escape
 *  hatch if the governor has not settled somewhere comfortable. */
function forcedTier(): TierName | undefined {
  const value = new URLSearchParams(location.search).get('tier');
  return value === 'high' || value === 'medium' || value === 'low' || value === 'floor'
    ? value
    : undefined;
}

function boot(): void {
  const canvas = document.querySelector<HTMLCanvasElement>('#scene');
  const contentRoot = document.querySelector<HTMLElement>('#content');
  if (!canvas || !contentRoot) return;

  applyMeta();
  renderChrome(document);
  mountNav(document);
  renderSections(contentRoot);
  observeReveals();

  if (!supportsWebGL()) {
    document.documentElement.classList.add('no-webgl');
    return;
  }

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let renderer: GeodesicRenderer;
  try {
    const steps = Number(new URLSearchParams(location.search).get('steps')) || undefined;
    renderer = new GeodesicRenderer({
      canvas,
      reducedMotion,
      forceTier: forcedTier(),
      stepOverride: steps,
    });
  } catch (error) {
    console.error('Geodesic renderer failed to initialise', error);
    document.documentElement.classList.add('no-webgl');
    return;
  }

  document.documentElement.classList.add('has-webgl');

  const pointer = { x: 0, y: 0 };
  const narrow = () => window.innerWidth < 900;
  /** Held camera pose that outranks the scroll position, for map previews. */
  let override: CameraState | null = null;

  /**
   * Scroll position and pointer both feed one pose, which the renderer damps
   * toward. Routing every input through a single filter is what keeps the
   * camera continuous — no section ever snaps.
   */
  const syncCamera = () => {
    // The readout annotates the hero; past it, it would sit under the copy.
    document.documentElement.classList.toggle(
      'is-scrolled',
      window.scrollY > window.innerHeight * 0.35,
    );

    let pose = poseForProgress(scrollProgress());
    if (narrow()) pose = adaptForNarrow(pose, window.innerWidth / window.innerHeight);

    // A held override beats the scroll pose. Without this the preview would last
    // one frame: scroll and pointermove both land here, and either would put the
    // camera straight back where the scroll position says it belongs.
    renderer.setCamera(override ?? applyPointer(pose, pointer.x, pointer.y));

    // The dial always reports the *scroll* azimuth, which is what a released
    // preview has to fall back to.
    updateNav(pose.azimuth, activeSection());
  };

  /**
   * The map's station hover flies the real camera.
   *
   * The renderer already damps toward whatever pose it is handed, so a preview
   * is just handing it a different one — there is no second animation system
   * here, and letting go returns to whatever the scroll position says.
   */
  const poseFor = (id: string) => {
    const i = KEYFRAMES.findIndex((k) => k.id === id);
    if (i < 0) return null;
    let pose = poseForProgress(i / (KEYFRAMES.length - 1));
    if (narrow()) pose = adaptForNarrow(pose, window.innerWidth / window.innerHeight);
    return pose;
  };

  let settleTimer = 0;
  const clearOverride = () => {
    window.clearTimeout(settleTimer);
    override = null;
    syncCamera();
  };

  setCameraHooks({
    preview(id) {
      const pose = poseFor(id);
      if (!pose) return;
      window.clearTimeout(settleTimer);
      override = pose;
      syncCamera();
    },
    release: clearOverride,
    settle(id) {
      const pose = poseFor(id);
      if (!pose) return;
      if (reducedMotion) {
        clearOverride();
        return;
      }
      // Carry a little past the target and let the damping fall back into it,
      // so arriving reads as an orbit catching rather than a value snapping.
      // Held for the length of the smooth scroll, which would otherwise drive
      // the camera straight to the destination with no swing at all.
      const first = KEYFRAMES.findIndex((k) => k.id === id) === 0;
      override = { ...pose, azimuth: pose.azimuth + (first ? -0.16 : 0.16) };
      syncCamera();
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(clearOverride, 620);
    },
  });

  syncCamera();
  renderer.start();

  window.addEventListener('scroll', syncCamera, { passive: true });

  if (!reducedMotion) {
    window.addEventListener(
      'pointermove',
      (event) => {
        pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
        pointer.y = -((event.clientY / window.innerHeight) * 2 - 1);
        syncCamera();
      },
      { passive: true },
    );

    // Nothing to animate for a hidden tab, and mobile browsers penalise
    // background GPU work hard.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) renderer.stop();
      else renderer.start();
    });
  }

  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      renderer.resize();
      syncCamera();
    }, 120);
  });

  // Exposed for the physics self-test and for tuning in devtools.
  Object.assign(window, { __blackhole: renderer });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
