# Portfolio — geodesic black hole

A portfolio site fronted by a Schwarzschild black hole that is **integrated, not
faked**: one null geodesic is traced per pixel through curved spacetime, and the
shadow, photon ring, Einstein ring and the disk's secondary image all fall out
of that integration rather than being drawn on top.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static bundle in dist/
npm run preview
```

## Fill in your content

**Everything user-facing lives in [`src/content.ts`](src/content.ts)** — name,
role, bio, projects, skills, contact. Nothing else in the project hardcodes
copy.

It currently ships full of `TODO` placeholders, and the page says so in the
corner while they are there. That is deliberate: a portfolio with invented
projects in it is worse than one that is visibly unfinished. Replace every
`TODO` and the notice disappears on its own.

## The physics

[`src/blackhole/physics.ts`](src/blackhole/physics.ts) is the single source of
truth, in geometric units where the Schwarzschild radius `Rs = 1`. The same
constants are injected into GLSL as `#define`s so TypeScript and the shaders
cannot drift apart.

Photon motion in Schwarzschild geometry is planar, so every ray reduces to a 2-D
problem in its own orbital plane, governed exactly by the Binet form

```
d²u/dφ² = 3Mu² − u        (u = 1/r)
```

`geodesic.frag.glsl` integrates this with RK4, per pixel. There is no weak-field
expansion and no fitted constant anywhere in the render.

| Quantity | Value | How it appears |
| --- | --- | --- |
| Event horizon | `2M = Rs` | rays that reach it stop |
| Photon sphere | `3M = 1.5 Rs` | rays wind here; the bright ring |
| ISCO | `6M = 3 Rs` | inner edge of the disk |
| Critical impact parameter | `3√3 M ≈ 2.598 Rs` | the shadow's apparent radius |

The disk uses a Shakura–Sunyaev flux profile with a zero-torque inner boundary,
`F ∝ r⁻³(1 − √(r_in/r))`, so emission tapers to nothing at the ISCO. Light from
it is shifted by

```
g = √(1 − 3M/r) / (1 + Ω λ)      Ω = ±√(M/r³),  λ = L_z/E
```

which carries gravitational redshift and relativistic Doppler in one term.
Observed intensity goes as `g⁴` (because `I_ν/ν³` is a Lorentz invariant) and
the observed colour is a blackbody at `g·T`, mapped through a fit to the
Planckian locus. The bright approaching limb and dim receding limb are
consequences of that, not art direction.

**The one departure:** a Schwarzschild hole cannot launch jets — Blandford–Znajek
needs spin and an ergosphere. The jets imply a Kerr hole; everything else here
is Schwarzschild. Their bulk speed is also below a real jet's, because at the
true value the transverse Doppler term would de-boost them into invisibility at
this viewing angle.

### Verified against theory

`physics-test` measures the **rendered pixels** against closed-form GR — it
reads nothing from the shader's own constants. With the disk off and a flat sky,
it finds the shadow's edge to sub-pixel accuracy along four rays and compares it
to the exact angular radius for an observer at finite `r₀`:

```
sin ψ = b_crit √(1 − 2M/r₀) / r₀
```

| Camera distance | Predicted | Measured | Error |
| --- | --- | --- | --- |
| 50 Rs | 56.6 px | 56.9 px | **0.56 %** |
| 34 Rs | 83.0 px | 83.7 px | **0.92 %** |
| 22 Rs | 127.7 px | 131.5 px | 2.97 % |

The close-range figure is step-budget limited and understood: near the photon
sphere a ray can wind through many radians, and any that exhausts `MAX_STEPS` is
counted as captured, which inflates the shadow slightly. Raising the budget from
256 to 700 steps takes the 22 Rs error from 4.6 % to 3.0 %, confirming it is
discretization rather than a modelling error.

## Design

The page has **no panels behind its text**. Instead the camera is choreographed
against scroll position ([`src/scroll/choreography.ts`](src/scroll/choreography.ts)):
each section declares a pose, the renderer damps toward it, and the bright parts
of the scene are deliberately moved out from wherever the words are. Contrast
comes from composition, which is only possible because the render is ours to
aim. A soft edgeless veil and text shadows cover the residual.

Type is **Instrument Serif** for display — a high-contrast editorial face
against a hard-science subject, which is the page's one deliberate risk —
with **Inter Tight** for body and **JetBrains Mono** for data and labels. All
self-hosted; no font CDN. The palette is taken from the simulation: the ground
is the blue-black of deep space, the accent is the disk's own blackbody amber,
and the cool tone is its Doppler-blueshifted limb.

## Performance

Per-pixel geodesic integration is expensive, so three levers carry it:

- **Reduced-resolution march.** The lensed field is smooth except at the photon
  ring, so rays are traced at a fraction of native and upscaled.
- **Temporal accumulation as AA.** Each frame jitters the ray on a Halton
  sequence and converges into a history buffer. This is what buys back the
  detail lost to marching below native resolution.
- **Three tiers** (rayScale 0.75/0.55/0.40, 256/160/96 steps), picked from
  device signals, with a governor that demotes one tier after sustained
  sub-45fps. Demotion is one-way — oscillating is worse than running lower.

`?tier=high|medium|low` and `?steps=N` override both, for testing.

**Frame rate is unverified.** The development container has no GPU — Chromium
falls back to a software rasteriser — so no frame-rate claim in this repo has
been measured on real hardware. Correctness, layout, contrast and fallbacks
were all verified; speed was not.

## Accessibility

- Every word is real DOM text; the canvas is `aria-hidden`.
- Contrast measured against the **live render** — 69 text runs sampled per pass,
  worst ratio 5.75–6.2 across runs. One run in three showed a single small-text
  run dipping to 2.2 as the idle camera drift moved the disk behind it.
- `prefers-reduced-motion: reduce` renders one static frame and never starts
  the loop (verified: zero `requestAnimationFrame` calls).
- No WebGL → CSS poster, all content and links intact.

## Layout

```
src/
  content.ts                 all copy — the only file to edit
  main.ts                    bootstrap; wires scroll + pointer to the camera
  scroll/choreography.ts     section poses and blending
  ui/sections.ts             builds the DOM from content
  blackhole/
    physics.ts               constants and closed forms, shared with GLSL
    GeodesicRenderer.ts      pass graph, targets, camera, tiers
    quality.ts               tiers and the FPS governor
    fullscreen.ts            fullscreen-triangle pass helper
    shaders/
      geodesic.frag.glsl     the integrator
      disk.glsl  jet.glsl  sky.glsl  noise.glsl
      accumulate / bright / downsample / upsample / anamorphic / composite
  styles/main.css
  fonts/
```

`window.__blackhole` exposes the renderer for tuning in devtools.
