/**
 * Disk thickness self-test.
 *
 * It is easy to make a disk *look* thicker by making it blurrier. This checks
 * that the scale height parameter genuinely controls the rendered thickness —
 * by measuring the image, not by reading the shader's constants.
 *
 * Method, and why it is a ratio rather than an absolute.
 *
 * An absolute prediction is unreliable here. Three effects widen the rendered
 * profile beyond the naive single-Gaussian width 0.6086·H:
 *
 *   1. the disk is flared, so a ray at tangent radius r also passes through
 *      larger radii where H is bigger (computed: about +19 % on average);
 *   2. lensed light from the far side arcs above and below the midplane;
 *   3. the march runs below native resolution and is then upscaled.
 *
 * Rather than model all three, the test doubles H/R and asserts the rendered
 * thickness doubles. Every one of those effects is common to both renders and
 * cancels in the ratio, and the ratio is what actually answers the question:
 * is this a real scale height, or arbitrary softness?
 *
 * Width is measured at half maximum, not as RMS. RMS weights by y², which
 * makes it dominated by exactly the faint lensed tails that cannot be cleanly
 * excluded — an earlier version of this test used RMS and read 78 % high for
 * that reason.
 */
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

const OUT = process.env.OUT_DIR ?? '.';
const URL = 'http://127.0.0.1:4173/?tier=high';

const BASE_HR = 0.05; // must match DISK_SCALE_HEIGHT in physics.ts
const W = 1200;
const H = 800;

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
await page.goto(URL, { waitUntil: 'load' });
await page.waitForTimeout(3000);

await page.evaluate(() => {
  const bh = window.__blackhole;
  bh.completeIntro();
  bh.setDiskProbe(true);
  // Exactly edge-on: the disk becomes a band whose vertical extent is the
  // quantity under test.
  bh.setCamera({ distance: 30, azimuth: 0, elevation: 0, focusX: 0, focusY: 0 });
  for (const sel of ['.veil', '.poster', '.chrome', '.readout', 'main', '.placeholder-notice']) {
    document.querySelectorAll(sel).forEach((n) => { n.style.display = 'none'; });
  }
});

const cx = Math.floor(W / 2);
const cy = Math.floor(H / 2);

async function measure(hr) {
  await page.evaluate((v) => window.__blackhole.setScaleHeight(v), hr);
  await page.waitForTimeout(11000);

  const shot = await page.screenshot({ clip: { x: 0, y: 0, width: W, height: H } });
  const png = PNG.sync.read(shot);
  const lumAt = (x, y) => {
    const i = (png.width * y + x) * 4;
    return (0.2126 * png.data[i] + 0.7152 * png.data[i + 1] + 0.0722 * png.data[i + 2]) / 255;
  };

  /** Full width at half maximum of one column, in pixels. */
  const columnFwhm = (x) => {
    const prof = [];
    for (let y = cy - 200; y <= cy + 200; y++) prof.push(lumAt(x, y));
    const peak = Math.max(...prof);
    if (peak < 0.02) return null;
    const half = peak * 0.5;
    let lo = -1;
    let hi = -1;
    for (let i = 0; i < prof.length; i++) if (prof[i] >= half) { lo = i; break; }
    for (let i = prof.length - 1; i >= 0; i--) if (prof[i] >= half) { hi = i; break; }
    return hi > lo ? hi - lo : null;
  };

  const widths = [];
  for (const sign of [1, -1]) {
    for (let dx = 170; dx <= 420; dx += 10) {
      const w = columnFwhm(cx + sign * dx);
      if (w !== null) widths.push({ radius: dx, width: w });
    }
  }

  // Least-squares slope through the origin — the disk has zero thickness at r=0.
  let num = 0;
  let den = 0;
  for (const s of widths) {
    num += s.radius * s.width;
    den += s.radius * s.radius;
  }
  await page.screenshot({ path: `${OUT}/disk-thickness-${hr}.png` });
  return { hr, samples: widths.length, slope: num / den };
}

const a = await measure(BASE_HR);
const b = await measure(BASE_HR * 2);

const ratio = b.slope / a.slope;
const errorPercent = ((ratio - 2) / 2) * 100;

console.log(JSON.stringify({
  atBaseHR: { hr: a.hr, samples: a.samples, fwhmPerRadius: +a.slope.toFixed(5) },
  atDoubleHR: { hr: b.hr, samples: b.samples, fwhmPerRadius: +b.slope.toFixed(5) },
  expectedRatio: 2,
  measuredRatio: +ratio.toFixed(4),
  errorPercent: +errorPercent.toFixed(2),
}, null, 2));

const pass = Math.abs(errorPercent) < 12;
console.log(`doubling H/R scales rendered thickness by ${ratio.toFixed(3)} (want 2.000)`);
console.log(pass ? 'PASS' : 'FAIL');

await browser.close();
