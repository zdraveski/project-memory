// Renders each picture in this folder to a 2x WebP in docs/.
// Needs Playwright: `npx playwright install chromium`, then `node docs/art/render.mjs`.
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
  const png = await page.locator('.art').screenshot({ omitBackground: true });
  // PNG of these glows is ~1 MB each; WebP at 0.9 looks the same at a tenth of the size.
  const webp = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const canvas = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height });
    canvas.getContext('2d').drawImage(img, 0, 0);
    return canvas.toDataURL('image/webp', 0.9).split(',')[1];
  }, png.toString('base64'));
  const target = join(out, file.replace(/\.html$/, '.webp'));
  writeFileSync(target, Buffer.from(webp, 'base64'));
  console.log(target);
}
await browser.close();
