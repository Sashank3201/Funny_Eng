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

/** Stations on the map, which unlike the header nav includes the hero. */
const STATIONS: NavSection[] = [{ id: 'hero', label: 'Top' }, ...SECTIONS];

/**
 * Hooks into the renderer, set by main.ts.
 *
 * Hovering a station flies the real camera rather than animating a picture of
 * one: the renderer already damps toward whatever pose it is given, so handing
 * it the station's pose is the whole implementation of the preview.
 */
export interface CameraHooks {
  /** Show a station's pose without committing to it. */
  preview(id: string): void;
  /** Return to whatever the scroll position says. */
  release(): void;
  /** Nudge past the target on arrival so the camera settles into it. */
  settle(id: string): void;
}

let hooks: CameraHooks | null = null;

export function setCameraHooks(h: CameraHooks): void {
  hooks = h;
}

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

/**
 * The expanded dial: a plan view of the orbit with the sections plotted on it at
 * their true azimuth, labelled with the radius each one actually flies at.
 *
 * Drawn in a 100×100 viewBox so the geometry can be read directly; `pointAt`
 * from the header dial is reused with a larger radius, which is what keeps the
 * two views of the same orbit honest about each other.
 */
function buildMap(stage: HTMLElement): { marker: SVGCircleElement; links: HTMLAnchorElement[] } {
  const R = 34;
  const R_LABEL = 44;

  const root = svg('svg', { viewBox: '0 0 100 100', class: 'map__svg' });
  root.setAttribute('aria-hidden', 'true');

  const scale = (p: { x: number; y: number }) => ({
    x: 50 + (p.x - CX) * (R / R_ORBIT),
    y: 50 + (p.y - CY) * (R / R_ORBIT),
  });

  const a = scale(pointAt(KEYFRAMES[0].azimuth));
  const b = scale(pointAt(KEYFRAMES[KEYFRAMES.length - 1].azimuth));
  const largeArc =
    Math.abs(KEYFRAMES[KEYFRAMES.length - 1].azimuth - KEYFRAMES[0].azimuth) > Math.PI ? 1 : 0;

  root.append(
    svg('circle', { cx: 50, cy: 50, r: R, class: 'map__path' }),
    svg('path', {
      d: `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${R} ${R} 0 ${largeArc} 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`,
      class: 'map__arc',
    }),
    svg('circle', { cx: 50, cy: 50, r: 13.5, class: 'map__photon' }),
    svg('circle', { cx: 50, cy: 50, r: 9.6, class: 'map__shadow' }),
  );

  for (const frame of KEYFRAMES) {
    const p = scale(pointAt(frame.azimuth));
    root.append(svg('circle', { cx: p.x.toFixed(2), cy: p.y.toFixed(2), r: 1.6, class: 'map__station' }));
  }

  const marker = svg('circle', { cx: a.x.toFixed(2), cy: a.y.toFixed(2), r: 2.8, class: 'map__marker' });
  root.append(marker);
  stage.append(root);

  // Labels are real anchors positioned over the SVG, not <text> inside it, so
  // they are ordinary focusable links with ordinary type rendering.
  const links: HTMLAnchorElement[] = [];
  STATIONS.forEach((station, i) => {
    const frame = KEYFRAMES.find((k) => k.id === station.id);
    if (!frame) return;
    const p = pointAt(frame.azimuth, R_ORBIT * (R_LABEL / R));
    const link = document.createElement('a');
    link.className = 'station';
    link.href = `#${station.id}`;
    link.dataset.section = station.id;
    link.style.left = `${50 + (p.x - CX) * (R / R_ORBIT)}%`;
    link.style.top = `${50 + (p.y - CY) * (R / R_ORBIT)}%`;
    link.style.setProperty('--i', String(i));

    const index = document.createElement('span');
    index.className = 'station__index';
    index.textContent = String(i).padStart(2, '0');
    const name = document.createElement('span');
    name.className = 'station__name';
    name.textContent = station.label;
    const radius = document.createElement('span');
    radius.className = 'station__radius';
    // The distance each pose actually flies at, straight from the keyframe.
    radius.textContent = `${frame.distance} Rs`;

    link.append(index, name, radius);
    stage.append(link);
    links.push(link);
  });

  return { marker, links };
}

interface NavRefs {
  marker: SVGCircleElement;
  mapMarker: SVGCircleElement | null;
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

/** Orbit radius of the expanded map, in its own 100×100 viewBox. */
const MAP_R = 34;

function moveMarker(marker: SVGCircleElement, azimuth: number, mapRadius?: number): void {
  const p = pointAt(azimuth);
  if (mapRadius === undefined) {
    marker.setAttribute('cx', p.x.toFixed(3));
    marker.setAttribute('cy', p.y.toFixed(3));
    return;
  }
  const k = mapRadius / R_ORBIT;
  marker.setAttribute('cx', (50 + (p.x - CX) * k).toFixed(3));
  marker.setAttribute('cy', (50 + (p.y - CY) * k).toFixed(3));
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

  const stage = root.querySelector<HTMLElement>('[data-map-stage]');
  const map = stage ? buildMap(stage) : null;

  const links = [...makeLinks(root.querySelector('[data-nav]'), 'nav__link'), ...(map?.links ?? [])];
  const toggle = root.querySelector<HTMLButtonElement>('[data-navtoggle]');
  const dialog = root.querySelector<HTMLDialogElement>('[data-map]');

  const state: NavRefs = {
    marker,
    mapMarker: map?.marker ?? null,
    links,
    cameraAzimuth: KEYFRAMES[0].azimuth,
    previewing: false,
  };
  refs = state;

  // Hovering a link ghosts the marker to that section's azimuth, so the ring
  // answers "where would that take me" before the click rather than after it.
  for (const link of links) {
    const id = link.dataset.section ?? '';
    const preview = () => {
      const az = azimuthOf(id);
      if (az === null) return;
      state.previewing = true;
      host.classList.add('is-previewing');
      moveMarker(marker, az);
      if (state.mapMarker) moveMarker(state.mapMarker, az, MAP_R);
      // The real camera, not a picture of one.
      hooks?.preview(id);
    };
    const clear = () => {
      state.previewing = false;
      host.classList.remove('is-previewing');
      moveMarker(marker, state.cameraAzimuth);
      if (state.mapMarker) moveMarker(state.mapMarker, state.cameraAzimuth, MAP_R);
      hooks?.release();
    };
    link.addEventListener('pointerenter', preview);
    link.addEventListener('focus', preview);
    link.addEventListener('pointerleave', clear);
    link.addEventListener('blur', clear);
    link.addEventListener('click', () => {
      state.previewing = false;
      hooks?.settle(id);
    });
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

  if (dialog) {
    const label = toggle?.querySelector('.navtoggle__label');

    const setOpen = (open: boolean) => {
      toggle?.setAttribute('aria-expanded', String(open));
      if (label) label.textContent = open ? 'Close' : 'Map';
      document.documentElement.classList.toggle('is-map-open', open);

      if (open) {
        // Grow from wherever the dial currently sits, so the map reads as the
        // same object enlarged rather than as a panel arriving from nowhere.
        const r = host.getBoundingClientRect();
        dialog.style.setProperty('--dx', `${r.left + r.width / 2 - window.innerWidth / 2}px`);
        dialog.style.setProperty('--dy', `${r.top + r.height / 2 - window.innerHeight / 2}px`);
        dialog.showModal();
        // Flush style so the collapsed transform is committed before the open
        // class changes it; otherwise both land in one recalc and there is
        // nothing to transition from. A forced reflow does this deterministically
        // where a rAF callback did not — on a phone the class simply never
        // arrived and the map stayed at 6 % scale in the corner.
        void dialog.offsetWidth;
        dialog.classList.add('is-open');
      } else {
        dialog.classList.remove('is-open');
        hooks?.release();
        const done = () => dialog.close();
        // Let the collapse play, but never strand the dialog open if the
        // transition never fires (reduced motion, or a stalled compositor).
        dialog.addEventListener('transitionend', done, { once: true });
        window.setTimeout(done, 420);
      }
    };

    // The dial and the toggle are the same control at two widths.
    host.addEventListener('click', (e) => {
      e.preventDefault();
      setOpen(true);
    });
    toggle?.addEventListener('click', () => setOpen(dialog.open !== true));

    for (const link of map?.links ?? []) link.addEventListener('click', () => setOpen(false));

    // `close` fires for Escape and for the backdrop too, so the button state is
    // synced here rather than only in setOpen.
    dialog.addEventListener('close', () => {
      dialog.classList.remove('is-open');
      toggle?.setAttribute('aria-expanded', 'false');
      if (label) label.textContent = 'Map';
      document.documentElement.classList.remove('is-map-open');
      hooks?.release();
    });

    // Clicking the backdrop — the dialog element itself outside its stage.
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) setOpen(false);
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
  if (!refs.previewing) {
    moveMarker(refs.marker, azimuth);
    if (refs.mapMarker) moveMarker(refs.mapMarker, azimuth, MAP_R);
  }

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
