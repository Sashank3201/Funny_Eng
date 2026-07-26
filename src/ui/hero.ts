import { content } from '../content';

/** Fill the hero markup from `content.ts`, so copy lives in exactly one place. */
export function renderHeroContent(root: ParentNode): void {
  const set = (selector: string, text: string) => {
    const el = root.querySelector(selector);
    if (el) el.textContent = text;
  };

  set('[data-hero-eyebrow]', content.eyebrow);
  set('[data-hero-name]', content.name);
  set('[data-hero-tagline]', content.tagline);
  set('[data-hero-caption]', content.caption);

  const actions = root.querySelector('[data-hero-actions]');
  if (actions) {
    actions.replaceChildren(
      ...content.actions.map((action) => {
        const a = document.createElement('a');
        a.className = action.primary
          ? 'btn btn--primary glass glass--pill'
          : 'btn glass glass--pill';
        a.href = action.href;
        a.textContent = action.label;
        return a;
      }),
    );
  }

  const links = root.querySelector('[data-hero-links]');
  if (links) {
    links.replaceChildren(
      ...content.links.map((link) => {
        const a = document.createElement('a');
        a.className = 'hero__link';
        a.href = link.href;
        a.textContent = link.label;
        a.rel = 'noopener noreferrer';
        a.target = '_blank';
        return a;
      }),
    );
  }
}

export interface PointerBinding {
  dispose(): void;
}

/**
 * Report pointer position in normalised -1..1 coordinates. Uses Pointer Events
 * so touch drags work without a separate code path, and recentres when the
 * pointer leaves the window so the scene drifts back to rest.
 */
export function bindPointer(
  target: HTMLElement,
  onMove: (x: number, y: number) => void,
): PointerBinding {
  const root = document.documentElement;

  /** Drive the glass sheen from the same pointer that drives the camera, so
   *  the specular highlight and the scene agree on where the light is. */
  const setSheen = (px: number, py: number) => {
    root.style.setProperty('--mx', `${(px * 100).toFixed(1)}%`);
    root.style.setProperty('--my', `${(py * 100).toFixed(1)}%`);
  };

  const handleMove = (event: PointerEvent) => {
    const px = event.clientX / window.innerWidth;
    const py = event.clientY / window.innerHeight;
    setSheen(px, py);
    onMove(px * 2 - 1, -(py * 2 - 1));
  };

  const handleLeave = () => {
    setSheen(0.5, 0);
    onMove(0, 0);
  };

  target.addEventListener('pointermove', handleMove, { passive: true });
  target.addEventListener('pointerleave', handleLeave);
  window.addEventListener('blur', handleLeave);

  return {
    dispose() {
      target.removeEventListener('pointermove', handleMove);
      target.removeEventListener('pointerleave', handleLeave);
      window.removeEventListener('blur', handleLeave);
    },
  };
}

/** Reveal the hero copy once the first frame is on screen. */
export function revealHero(root: HTMLElement): void {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => root.classList.add('is-ready'));
  });
}
