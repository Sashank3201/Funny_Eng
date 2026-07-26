import './styles/main.css';
import './styles/glass.css';

import { BlackHoleRenderer } from './blackhole/Renderer';
import { detectTier } from './blackhole/quality';
import { bindPointer, renderHeroContent, revealHero } from './ui/hero';

function supportsWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(
      canvas.getContext('webgl2') ??
        canvas.getContext('webgl') ??
        canvas.getContext('experimental-webgl'),
    );
  } catch {
    return false;
  }
}

/**
 * `backdrop-filter` over a live WebGL canvas forces the compositor to re-read
 * the canvas every frame, which is expensive enough on weaker hardware to cost
 * real frames. The glass surfaces keep their geometry either way — only the
 * blur is dropped.
 */
function enableGlass(): boolean {
  if (!detectTier().glass) return false;
  // A touch device that passed the tier check is still usually a phone.
  return !window.matchMedia('(pointer: coarse)').matches;
}

function boot(): void {
  const hero = document.querySelector<HTMLElement>('.hero');
  const canvas = document.querySelector<HTMLCanvasElement>('#scene');
  if (!hero || !canvas) return;

  renderHeroContent(document);
  revealHero(hero);

  if (enableGlass()) document.documentElement.classList.add('has-glass');

  if (!supportsWebGL()) {
    // The CSS poster behind the canvas is already visible; just make sure the
    // dead canvas is out of the way.
    document.documentElement.classList.add('no-webgl');
    return;
  }

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let renderer: BlackHoleRenderer;
  try {
    renderer = new BlackHoleRenderer({ canvas, reducedMotion });
  } catch (error) {
    console.error('Black hole renderer failed to initialise', error);
    document.documentElement.classList.add('no-webgl');
    return;
  }

  document.documentElement.classList.add('has-webgl');
  renderer.start();

  if (!reducedMotion) {
    bindPointer(document.body, (x, y) => renderer.setPointer(x, y));

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
    resizeTimer = window.setTimeout(() => renderer.resize(), 120);
  });

  // Expose the instance for the Playwright checks and for tuning in devtools.
  Object.assign(window, { __blackhole: renderer });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
