import { KEYFRAMES } from '../scroll/choreography';

/**
 * The navigation, as an instrument.
 *
 * Scrolling this page moves the camera around the black hole: the keyframes run
 * from azimuth 0 to 3.5 rad, a little over 200° of a single orbit, while the
 * radius falls from 33 Rs to 29. The ring in the header is a plan view of that
 * orbit seen down the spin axis, and the marker on it is where the camera
 * actually is — the same number the renderer is using that frame, not an
 * animation timed to look similar.
 *
 * Every coordinate here is derived from `KEYFRAMES`, so the station dots cannot
 * drift away from the poses they stand for.
 *
 * The ring is an enhancement and never the mechanism. The links are ordinary
 * anchors that work with it removed, and the ring itself is `aria-hidden` — it
 * conveys position, which `aria-current` on the links already says in words.
 */

/** Ring geometry in the SVG's 24×24 viewBox. */
const CX = 12;
const CY = 12;
const R_ORBIT = 9;

export interface NavSection {
  id: string;
  label: string;
}

export const SECTIONS: NavSection[] = [
  { id: 'work', label: 'Work' },
  { id: 'about', label: 'About' },
  { id: 'contact', label: 'Contact' },
];

/**
 * Azimuth to a point on the dial.
 *
 * The camera sits at `(sin az·cos el, sin el, cos az·cos el)`, so looking down
 * the +Y axis its position in the orbital plane is `(sin az, cos az)`. Drawing
 * +Z up and +X right makes this a compass bearing: azimuth 0 is at the top of
 * the ring, and increasing azimuth runs clockwise on screen because SVG's y axis
 * points down.
 */
function pointAt(azimuth: number, radius = R_ORBIT): { x: number; y: number } {
  return {
    x: CX + radius * Math.sin(azimuth),
    y: CY - radius * Math.cos(azimuth),
  };
}

function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

/** The dial. Returns the marker so the caller can move it without a re-query. */
function buildOrbit(host: HTMLElement): SVGCircleElement {
  const root = svg('svg', { viewBox: '0 0 24 24', class: 'orbit__svg' });
  root.setAttribute('aria-hidden', 'true');
  root.setAttribute('focusable', 'false');

  const first = KEYFRAMES[0].azimuth;
  const last = KEYFRAMES[KEYFRAMES.length - 1].azimuth;
  const a = pointAt(first);
  const b = pointAt(last);
  // The traversed span is over 180°, so the arc needs the large-arc flag; sweep
  // is 1 because increasing azimuth reads clockwise once y points down.
  const largeArc = Math.abs(last - first) > Math.PI ? 1 : 0;

  root.append(
    // The rest of the orbit, which this page never travels.
    svg('circle', { cx: CX, cy: CY, r: R_ORBIT, class: 'orbit__path' }),
    // The arc the scroll actually covers.
    svg('path', {
      d: `M ${a.x.toFixed(3)} ${a.y.toFixed(3)} A ${R_ORBIT} ${R_ORBIT} 0 ${largeArc} 1 ${b.x.toFixed(3)} ${b.y.toFixed(3)}`,
      class: 'orbit__arc',
    }),
    // The shadow, and the photon ring around it at the same ratio the render
    // shows: the ring sits at 1.5 Rs against a 2.6 Rs shadow radius.
    svg('circle', { cx: CX, cy: CY, r: 4.0, class: 'orbit__photon' }),
    svg('circle', { cx: CX, cy: CY, r: 2.9, class: 'orbit__shadow' }),
  );

  for (const frame of KEYFRAMES) {
    const p = pointAt(frame.azimuth);
    root.append(
      svg('circle', { cx: p.x.toFixed(3), cy: p.y.toFixed(3), r: 0.85, class: 'orbit__station' }),
    );
  }

  const marker = svg('circle', { cx: a.x.toFixed(3), cy: a.y.toFixed(3), r: 1.7, class: 'orbit__marker' });
  root.append(marker);

  host.append(root);
  return marker;
}

interface NavRefs {
  marker: SVGCircleElement;
  links: HTMLAnchorElement[];
  /** Azimuth the camera last reported, to fall back to when a preview ends. */
  cameraAzimuth: number;
  /** True while a link is hovered or focused and the marker is showing it. */
  previewing: boolean;
}

let refs: NavRefs | null = null;

/** Azimuth of a section id, for the hover preview. */
function azimuthOf(id: string): number | null {
  const frame = KEYFRAMES.find((k) => k.id === id);
  return frame ? frame.azimuth : null;
}

function moveMarker(marker: SVGCircleElement, azimuth: number): void {
  const p = pointAt(azimuth);
  marker.setAttribute('cx', p.x.toFixed(3));
  marker.setAttribute('cy', p.y.toFixed(3));
}

export function mountNav(root: ParentNode): void {
  const host = root.querySelector<HTMLElement>('[data-orbit]');
  if (!host) return;

  host.setAttribute('aria-label', 'Back to top');
  const marker = buildOrbit(host);

  const makeLinks = (container: Element | null, className: string): HTMLAnchorElement[] => {
    if (!container) return [];
    const made = SECTIONS.map((section) => {
      const a = document.createElement('a');
      a.className = className;
      a.href = `#${section.id}`;
      a.textContent = section.label;
      a.dataset.section = section.id;
      return a;
    });
    container.replaceChildren(...made);
    return made;
  };

  const links = [
    ...makeLinks(root.querySelector('[data-nav]'), 'nav__link'),
    ...makeLinks(root.querySelector('[data-sheet-nav]'), 'sheet__link'),
  ];
  const toggle = root.querySelector<HTMLButtonElement>('[data-navtoggle]');
  const sheet = root.querySelector<HTMLElement>('[data-sheet]');

  const state: NavRefs = { marker, links, cameraAzimuth: KEYFRAMES[0].azimuth, previewing: false };
  refs = state;

  // Hovering a link ghosts the marker to that section's azimuth, so the ring
  // answers "where would that take me" before the click rather than after it.
  for (const link of links) {
    const preview = () => {
      const az = azimuthOf(link.dataset.section ?? '');
      if (az === null) return;
      state.previewing = true;
      host.classList.add('is-previewing');
      moveMarker(marker, az);
    };
    const clear = () => {
      state.previewing = false;
      host.classList.remove('is-previewing');
      moveMarker(marker, state.cameraAzimuth);
    };
    link.addEventListener('pointerenter', preview);
    link.addEventListener('focus', preview);
    link.addEventListener('pointerleave', clear);
    link.addEventListener('blur', clear);
  }

  // The active state must not depend on the renderer: `updateNav` is normally
  // driven from the camera sync, which never runs on the no-WebGL fallback. This
  // keeps the links correct there by reusing the last azimuth the camera
  // reported, which on the fallback is simply the opening pose.
  window.addEventListener(
    'scroll',
    () => updateNav(state.cameraAzimuth, activeSection()),
    { passive: true },
  );

  if (toggle && sheet) {
    const label = toggle.querySelector('.navtoggle__label');
    const setOpen = (open: boolean) => {
      toggle.setAttribute('aria-expanded', String(open));
      sheet.hidden = !open;
      document.documentElement.classList.toggle('is-sheet-open', open);
      // The control is the same button either way, so it has to say which way
      // it now goes. `aria-expanded` covers this for assistive tech; this is for
      // everyone reading the screen.
      if (label) label.textContent = open ? 'Close' : 'Menu';
    };
    toggle.addEventListener('click', () => {
      setOpen(toggle.getAttribute('aria-expanded') !== 'true');
    });
    for (const link of links) link.addEventListener('click', () => setOpen(false));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
        setOpen(false);
        toggle.focus();
      }
    });
  }
}

/**
 * Called once per scroll sync with the pose the renderer is about to use, so the
 * marker and the camera cannot disagree.
 */
export function updateNav(azimuth: number, activeId: string | null): void {
  if (!refs) return;

  refs.cameraAzimuth = azimuth;
  if (!refs.previewing) moveMarker(refs.marker, azimuth);

  for (const link of refs.links) {
    const isActive = link.dataset.section === activeId;
    link.classList.toggle('is-active', isActive);
    if (isActive) link.setAttribute('aria-current', 'true');
    else link.removeAttribute('aria-current');
  }
}

/**
 * Which section owns the viewport right now.
 *
 * Measured against the middle of the screen rather than the top: with full-height
 * sections and a fixed header, a top-edge test flips to the next section while
 * most of the previous one is still on screen.
 */
export function activeSection(): string | null {
  const line = window.scrollY + window.innerHeight * 0.5;
  let current: string | null = null;
  for (const section of SECTIONS) {
    const el = document.getElementById(section.id);
    if (el && el.offsetTop <= line) current = section.id;
  }
  return current;
}
