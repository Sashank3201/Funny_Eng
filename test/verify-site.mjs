import { chromium } from 'playwright';
import { PNG } from 'pngjs';
const OUT = process.env.OUT_DIR ?? '.';
const BASE = 'http://127.0.0.1:4173/';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const out = [];

const srgb = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = (r, g, b) => 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);

// ---- 1. Mobile, all sections ----------------------------------------------
{
  const ctx = await browser.newContext({
    viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(13000);
  await page.screenshot({ path: `${OUT}/v3-mobile-hero.png` });
  await page.evaluate(() => document.getElementById('work').scrollIntoView());
  await page.waitForTimeout(8000);
  await page.screenshot({ path: `${OUT}/v3-mobile-work.png` });
  const m = await page.evaluate(() => ({
    tier: window.__blackhole?.tierName,
    hOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
  }));
  out.push({ case: 'mobile', ...m });
  await ctx.close();
}

// ---- 2. Reduced motion: one frame only -------------------------------------
{
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    window.__raf = 0;
    const o = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => { window.__raf++; return o(cb); };
  });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(5000);
  const a = await page.evaluate(() => window.__raf);
  await page.waitForTimeout(4000);
  const b = await page.evaluate(() => window.__raf);
  await page.screenshot({ path: `${OUT}/v3-reduced.png` });
  out.push({ case: 'reduced-motion', rafAt5s: a, rafAt9s: b, loopRunning: b > a + 2 });
  await ctx.close();
}

// ---- 3. No WebGL -----------------------------------------------------------
{
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    const o = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (t, ...r) {
      return String(t).includes('webgl') ? null : o.call(this, t, ...r);
    };
  });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  const s = await page.evaluate(() => ({
    docClasses: document.documentElement.className,
    canvasDisplay: getComputedStyle(document.querySelector('#scene')).display,
    h1: document.querySelector('h1')?.textContent,
    projects: document.querySelectorAll('.project').length,
    links: document.querySelectorAll('a').length,
  }));
  await page.screenshot({ path: `${OUT}/v3-nowebgl.png` });
  out.push({ case: 'no-webgl', ...s });
  await ctx.close();
}

// ---- 4. Measured contrast of every text run against the LIVE render --------
// Sample the actual rendered pixels behind each element, not an assumed colour.
{
  for (const vp of [{ width: 1440, height: 900, label: 'desktop' }, { width: 393, height: 852, label: 'mobile' }]) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1, isMobile: vp.label === 'mobile', hasTouch: vp.label === 'mobile' });
  const page = await ctx.newPage();
  await page.goto(BASE + '?tier=high', { waitUntil: 'load' });
  await page.waitForTimeout(12000);

  const worst = [];
  for (const id of ['hero', 'work', 'about', 'contact']) {
    await page.evaluate((s) => document.getElementById(s).scrollIntoView(), id);
    await page.waitForTimeout(8000);

    const boxes = await page.evaluate(() => {
      const sel = 'h1, h2, h3, p, a, dd, dt, li, span';
      return [...document.querySelectorAll(sel)]
        .filter((n) => n.textContent.trim() && n.offsetParent !== null)
        .map((n) => {
          const cs = getComputedStyle(n);
          // Measure the glyphs, not the element's box.
          //
          // A block-level <p> is as wide as its container even when its text
          // stops a quarter of the way across, so sampling the box samples
          // scene the reader never sees behind a letter. The hero eyebrow is
          // 832 px wide holding 223 px of text; the brightest pixel in that box
          // was 600 px to the right of the last glyph, out in the disk's glow.
          // That cuts both ways — it also let a genuinely bright patch pass
          // unnoticed whenever the disk happened to sit elsewhere.
          //
          // Range rects give the inline boxes the text actually occupies, one
          // per wrapped line.
          const rects = [];
          for (const child of n.childNodes) {
            if (child.nodeType !== Node.TEXT_NODE || !child.textContent.trim()) continue;
            const range = document.createRange();
            range.selectNodeContents(child);
            for (const r of range.getClientRects()) {
              if (r.width > 1 && r.height > 1) rects.push(r);
            }
          }
          // Each wrapped line is kept separately rather than unioned: a ragged
          // last line would otherwise drag the empty space beside it back in.
          const lines = (rects.length ? rects : [n.getBoundingClientRect()]).map((q) => ({
            x: Math.round(q.left), y: Math.round(q.top),
            w: Math.round(q.width), h: Math.round(q.height),
          }));
          // An element painting its own background (the primary CTA) is judged
          // against that, not against the scene behind the whole page.
          let ownBg = null;
          for (let a = n; a && a !== document.body; a = a.parentElement) {
            const bg = getComputedStyle(a).backgroundColor;
            const m = bg.match(/[\d.]+/g);
            if (m && (m.length < 4 || Number(m[3]) > 0.5)) { ownBg = bg; break; }
          }
          return {
            text: n.textContent.trim().slice(0, 28),
            color: cs.color,
            ownBg,
            lines,
            size: parseFloat(cs.fontSize),
          };
        })
        .map((b) => ({
          ...b,
          lines: b.lines.filter(
            (l) => l.w > 4 && l.h > 4 && l.y >= 0 && l.y + l.h <= window.innerHeight,
          ),
        }))
        .filter((b) => b.lines.length);
    });

    // Measure the backdrop with the text hidden. `visibility: hidden` keeps
    // layout intact, so the bounding boxes stay valid — sampling with the text
    // visible just measures the glyphs against themselves.
    await page.evaluate(() => {
      document.querySelectorAll('main, .chrome, .readout, .placeholder-notice')
        .forEach((n) => { n.style.visibility = 'hidden'; });
    });
    await page.waitForTimeout(400);
    const shot = await page.screenshot();
    const png = PNG.sync.read(shot);
    await page.evaluate(() => {
      document.querySelectorAll('main, .chrome, .readout, .placeholder-notice')
        .forEach((n) => { n.style.visibility = ''; });
    });

    for (const b of boxes) {
      const [tr, tg, tb] = b.color.match(/[\d.]+/g).slice(0, 3).map(Number);
      const alpha = Number((b.color.match(/[\d.]+/g) || [])[3] ?? 1);
      // Brightest background pixel under the run is the worst case for light text.
      let maxBg = 0;
      if (b.ownBg) {
        const [br, bg2, bb] = b.ownBg.match(/[\d.]+/g).slice(0, 3).map(Number);
        maxBg = lum(br, bg2, bb);
      } else
      for (const l of b.lines) {
        for (let y = l.y; y < l.y + l.h; y += 2) {
          for (let x = l.x; x < l.x + l.w; x += 3) {
            if (x < 0 || y < 0 || x >= png.width || y >= png.height) continue;
            const i = (png.width * y + x) * 4;
            maxBg = Math.max(maxBg, lum(png.data[i], png.data[i + 1], png.data[i + 2]));
          }
        }
      }
      // Composite the text colour over that background at its own alpha.
      const bg255 = maxBg;
      const eff = (c) => srgb(c) * alpha + bg255 * (1 - alpha);
      const L1 = 0.2126 * eff(tr) + 0.7152 * eff(tg) + 0.0722 * eff(tb);
      const [hi, lo] = L1 > maxBg ? [L1, maxBg] : [maxBg, L1];
      const ratio = (hi + 0.05) / (lo + 0.05);
      const large = b.size >= 24;
      worst.push({ section: id, text: b.text, size: b.size, ratio: +ratio.toFixed(2), needs: large ? 3 : 4.5, pass: ratio >= (large ? 3 : 4.5) });
    }
  }
  const fails = worst.filter((w) => !w.pass).sort((a, b) => a.ratio - b.ratio);
  out.push({
    case: `contrast-${vp.label}`,
    runsChecked: worst.length,
    failures: fails.length,
    worstFive: fails.slice(0, 5),
    minRatio: +Math.min(...worst.map((w) => w.ratio)).toFixed(2),
  });
  await ctx.close();
  }
}

console.log(JSON.stringify(out, null, 2));
await browser.close();
