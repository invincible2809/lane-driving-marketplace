// Renders PNG icons from the SVG logo files (needs Playwright's Chromium).
// Usage: node scripts/brand/render-icons.mjs
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const {chromium} = createRequire(import.meta.url)('playwright');
const dir = new URL('../../public/site/brand/', import.meta.url);
const jobs = [
  ['srk-mark.svg', 'favicon-32.png', 32],
  ['srk-mark.svg', 'favicon-48.png', 48],
  ['srk-app-icon.svg', 'apple-touch-icon.png', 180],
  ['srk-app-icon.svg', 'icon-512.png', 512]
];
const browser = await chromium.launch();
const page = await browser.newPage({deviceScaleFactor: 1});
for (const [src, out, size] of jobs) {
  const svg = readFileSync(new URL(src, dir), 'utf8').replace(/width="\d+" height="\d+"/, `width="${size}" height="${size}"`);
  await page.setViewportSize({width: size, height: size});
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
  await page.locator('svg').screenshot({path: new URL(out, dir).pathname, omitBackground: true});
  console.log(out, size + 'px');
}
await browser.close();
