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

No build plugins beyond Vite — shaders load through Vite's built-in `?raw`
import.

## Rebranding

All copy lives in [`src/content.ts`](src/content.ts): name, tagline, CTAs, and
links. That is the only file you need to touch. **The name defaults to
"Sashank"** — change it there.

Colour tokens and type are at the top of
[`src/styles/main.css`](src/styles/main.css); the glass material is a single
primitive in [`src/styles/glass.css`](src/styles/glass.css).

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
- **Light deflection** — `α = 2Rs/b`. The lens equation `b_img − α(b_img) = b` is
  solved in closed form, `b_img = ½(b + √(b² + 4k))`, which is what makes the far
  side of the disk arc up and over the shadow instead of being occluded by it.

### Two deliberate departures

Both are called out here rather than hidden in a magic number.

**The deflection coefficient is pinned, not derived.** The weak-field
`α = 2Rs/b` is only valid far from the hole. Used verbatim it throws the
strongly-lensed images out to ~2.8× the shadow radius instead of piling them
just outside the photon ring, so `k` is set from where the images should land
(`ARC_RATIO` in `Renderer.ts`). Full geodesic ray-marching would remove the
fudge at a cost this hero does not need to pay.

**The jets imply a hole this simulation does not model.** A Schwarzschild hole
cannot launch jets — Blandford–Znajek extracts rotational energy through the
ergosphere, which requires spin. Everything else here is Schwarzschild; the jets
are the one element that implies Kerr. Their bulk speed is also well below a real
jet's, because at the true value the transverse Doppler term would de-boost them
into invisibility at this viewing angle.

## Rendering pipeline

Seven stages per frame, all orchestrated in `Renderer.ts`:

1. **Starfield** → `rtStars`. Galactic band with dust lanes, domain-warped
   nebulae, distant galaxies, three parallax layers of stars with blackbody
   colour and diffraction spikes, all under large-scale extinction. **Cached** —
   it depends only on parallax and a slow twinkle, never on the camera, so it is
   redrawn only when one of those actually moves. That cache is what pays for
   how expensive the pass is.
2. **Lensing** → `rtBg`. Resamples the starfield through the deflection field,
   cuts out the shadow, and draws the photon ring.
3. **Disk + jets** → `rtEmissive`, additive, no depth buffer.
4. **Temporal accumulation** → history ping-pong. Motion blur, and the reason the
   disk reads as flowing light rather than a cloud of dots.
5. **Combine** → `rtScene`. Background plus the accumulated emissive layer.
6. **Bloom pyramid** — 13-tap downsample chain, 9-tap tent upsample, plus a wide
   horizontal blur for the anamorphic streak.
7. **Composite** — bloom, halation, streak, ACES tonemap, filmic S-curve,
   split-toning, vignette, aberration, grain, manual sRGB encode.

### Why streaks

Each disk and jet particle is an instanced quad stretched along the direction it
travels on screen during one shutter interval. The streak vector comes from
projecting the particle twice — now, and one shutter later — and taking the
screen-space difference, so it inherits the Keplerian shear and the lensing warp
for free: inner material draws longer streaks, and streaks bend correctly where
they wrap the shadow. Round sprites read as speckle; this reads as light.

Accumulation is applied to the emissive layer **only**. Blending the stars into
the history would smear them too. The blend weight rises with camera speed, which
is what stops the trails following the camera instead of the orbit.

## Performance

Three quality tiers (200k / 90k / 35k disk particles, with matching jet counts,
render scale and bloom depth), picked from device signals, then a runtime
governor that demotes one tier after 2s of sustained sub-50fps. Demotion is
one-way — oscillating between tiers is more noticeable than simply running at the
lower one.

Also: `devicePixelRatio` capped per tier, bloom at half resolution and below, the
starfield cached, the loop paused on `visibilitychange`, and resize debounced.

`backdrop-filter` forces the compositor to re-read the live canvas every frame,
so the glass blur is dropped on the low tier and on coarse pointers. The glass
surfaces keep their geometry either way — only the blur goes.

## Accessibility and fallbacks

- Every word is real DOM text; the canvas is `aria-hidden`. Nothing is painted
  into WebGL.
- The headline panel is masked so it dissolves toward the hole rather than
  cutting a rectangle across the frame. The fade is sized to start well past the
  copy — verified at 1024 / 1440 / 1920 / 2560.
- `prefers-reduced-motion: reduce` renders exactly one static frame and never
  starts the animation loop or the accumulation.
- No WebGL, or a renderer that throws → CSS poster gradient, copy untouched.

## Layout

```
src/
  content.ts              copy — the only file to edit when rebranding
  main.ts                 bootstrap, WebGL + reduced-motion + glass guards
  blackhole/
    physics.ts            constants and formulae, shared with GLSL
    Renderer.ts           pass graph, targets, camera, loop, governor
    Disk.ts               instanced streak geometry + material
    Jet.ts                twin relativistic jets
    Starfield.ts          background pass
    fullscreen.ts         fullscreen-triangle pass helper
    quality.ts            tiers and the FPS governor
    shaders/
      lensing.glsl        shared: lens equation, shadow occlusion
      streak.glsl         shared: motion-blur quad assembly + capsule coverage
      *.vert.glsl / *.frag.glsl
  ui/hero.ts              content binding, pointer, glass sheen, reveal
  styles/main.css         layout, type, reveals
  styles/glass.css        the liquid-glass primitive
```

`window.__blackhole` exposes the renderer for tuning uniforms in devtools.
