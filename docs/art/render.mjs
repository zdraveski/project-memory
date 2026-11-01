// Renders each picture in this folder to a 2x WebP in docs/.
// Needs Playwright: `npx playwright install chromium`, then `node docs/art/render.mjs`.
// A page holds a picture twice: .art.wide becomes <name>.webp, for a computer,
// and .art.narrow becomes <name>-narrow.webp, for a phone; the README's
// <picture> picks one by screen width, since one drawing can't be legible at both.
import { readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright');
const here = dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] || join(here, '..');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 900 }, deviceScaleFactor: 2 });
for (const file of readdirSync(here).filter((f) => f.endsWith('.html'))) {
  await page.goto(pathToFileURL(join(here, file)).href, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  for (const art of await page.locator('.art').all()) {
    const narrow = await art.evaluate((el) => el.classList.contains('narrow'));
    // A phone shows the narrow picture about 350 px wide: text under 26 px reads under 15 px there.
    const small = await art.evaluate((el, min) => [...el.querySelectorAll('*')]
      .filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()))
      .filter((e) => parseFloat(getComputedStyle(e).fontSize) < min)
      .map((e) => e.textContent.trim().slice(0, 40)), narrow ? 26 : 15);
    if (small.length) throw new Error(`${file}: text under the minimum: ${small.join(' | ')}`);
    const png = await art.screenshot({ omitBackground: true });
    // PNG of these glows is ~1 MB each; WebP at 0.9 looks the same at a tenth of the size.
    const webp = await page.evaluate(async (b64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const canvas = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height });
      canvas.getContext('2d').drawImage(img, 0, 0);
      return canvas.toDataURL('image/webp', 0.9).split(',')[1];
    }, png.toString('base64'));
    const target = join(out, file.replace(/\.html$/, narrow ? '-narrow.webp' : '.webp'));
    writeFileSync(target, Buffer.from(webp, 'base64'));
    console.log(target, (await art.boundingBox()).height);
  }
}
await browser.close();
