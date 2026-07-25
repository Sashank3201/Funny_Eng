# Particle Black Hole — Portfolio Hero

A single-page portfolio landing page whose hero is a full-viewport, GPU-animated
particle black hole. The simulation is driven by real Schwarzschild geometry
rather than a decorative swirl: Keplerian orbits, relativistic Doppler beaming,
gravitational redshift, and light deflection all come from the actual formulae.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static bundle in dist/
npm run preview  # serve the built bundle
```

No build plugins beyond Vite — shaders are loaded with Vite's built-in `?raw`
import.

## Rebranding

All copy lives in [`src/content.ts`](src/content.ts): name, tagline, CTAs, and
links. That is the only file you need to touch. **The name defaults to
"Sashank"** — change it there.

Colour tokens and type are at the top of
[`src/styles/main.css`](src/styles/main.css).

## The physics

[`src/blackhole/physics.ts`](src/blackhole/physics.ts) is the single source of
truth. It works in geometric units where the Schwarzschild radius `Rs = 1`, and
emits the same constants into the shaders as `#define`s, so TypeScript and GLSL
cannot drift apart.

| Quantity | Value | Where you see it |
| --- | --- | --- |
| Event horizon | `Rs` | — |
| Photon sphere | `1.5 Rs` | the thin bright ring |
| Shadow radius | `√27/2 ≈ 2.60 Rs` | the black disc, bigger than the horizon |
| ISCO | `3 Rs` | inner edge of the disk |

- **Keplerian shear** — `Ω = √(M/r³)`, so inner material laps the outer disk and
  shears it into streaks. Integrated in the vertex shader from a clock uniform.
- **Doppler beaming** — `δ = 1/(γ(1 − β·n̂))` with observed intensity `∝ δ³`. At
  the ISCO the orbital speed is ~0.41c, which is why one limb of the disk is
  white-hot and the other is a dim ember. This asymmetry is the single most
  recognisable feature in the image.
- **Gravitational redshift** — `√(1 − Rs/r)`, dimming the innermost disk even
  where beaming brightens it.
- **Temperature profile** — Shakura–Sunyaev thin disk, `T ∝ r^(−3/4)`, mapped
  through a blackbody colour ramp.
- **Light deflection** — `α = 2Rs/b`. The renderer solves the lens equation
  `b_img − α(b_img) = b_src` in closed form, `b_img = ½(b + √(b² + 4k))`, which
  is what makes the far side of the disk arc up and over the shadow instead of
  being occluded by it.

One deliberate departure from the textbook: the weak-field `α = 2Rs/b` is only
valid far from the hole, and using it verbatim throws the strongly-lensed images
out to ~2.8x the shadow radius instead of piling them just outside the photon
ring. So the deflection coefficient is pinned to where the images should
actually land (`ARC_RATIO` in `Renderer.ts`). Everything else is the real
formula. Full geodesic ray-marching would remove the fudge at a cost this hero
does not need to pay.

## Rendering pipeline

Five passes per frame, all in `Renderer.ts`:

1. **Starfield** → `rtStars`. Procedural, three parallax layers, no textures.
2. **Lensing** → `rtScene`. Resamples the starfield through the deflection
   field, cuts out the shadow, and draws the photon ring.
3. **Disk** → `rtScene`, additive, no depth buffer. 240k `Points` whose orbits
   are integrated entirely in the vertex shader, so the CPU never touches a
   position buffer.
4. **Bloom**. Bright-pass with a soft knee, then a separable Gaussian
   ping-pong at half resolution.
5. **Composite**. ACES tonemap, vignette, slight chromatic aberration, grain,
   manual sRGB encode.

The photon ring is drawn in the lensing pass rather than as its own mesh — it is
a perfect circle in screen space regardless of viewing angle, which is both what
the physics says and one fewer draw call.

## Performance

Three quality tiers (240k / 120k / 45k particles, with matching render scale and
bloom iterations) picked from device signals, then a runtime governor that
demotes one tier after 2s of sustained sub-50fps. Demotion is one-way —
oscillating between tiers is more noticeable than simply running at the lower
one.

Also: `devicePixelRatio` capped per tier, bloom at half resolution, the loop
paused on `visibilitychange`, and resize debounced.

## Accessibility and fallbacks

- Every word is real DOM text; the canvas is `aria-hidden`. Nothing is painted
  into WebGL.
- A scrim guarantees text contrast over whatever the simulation is doing.
- `prefers-reduced-motion: reduce` renders exactly one static frame and never
  starts the animation loop.
- No WebGL, or a renderer that throws → CSS poster gradient, copy untouched.
- Verified at 390, 768, 1440, and 2560px wide.

## Layout

```
src/
  content.ts              copy — the only file to edit when rebranding
  main.ts                 bootstrap, WebGL + reduced-motion guards
  blackhole/
    physics.ts            constants and formulae, shared with GLSL
    Renderer.ts           passes, render targets, camera, loop, governor
    Disk.ts               particle geometry + material
    Starfield.ts          background pass
    fullscreen.ts         fullscreen-triangle pass helper
    quality.ts            tiers and the FPS governor
    shaders/*.glsl
  ui/hero.ts              content binding, pointer, reveal
  styles/main.css
```

`window.__blackhole` exposes the renderer for tuning uniforms in devtools.
