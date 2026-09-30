// App-icon PNGs from the brand mark (2026-10-01). Companion to make-logo.mjs.
//
//   node make-app-icons.mjs
//
// Writes:
//   * apps/android-client/app/src/main/res/mipmap-{mdpi..xxxhdpi}/ic_launcher(_round).png
//     -- only Android 7.x (API 24-25) uses these; 8.0+ uses the vector adaptive icon in
//        mipmap-anydpi-v26 (orange @color/icon_bg + drawable/ic_launcher_foreground.xml).
//   * marketing/store-graphics/play-icon-512.png -- the Play Console "App icon": a FULL square,
//     no rounded corners, no transparency; Play cuts the corners itself.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const require = createRequire('D:/AKHIL/HP/projects/gamepados/apps/controller-ui/package.json');
const puppeteer = require('puppeteer-core');
const RES = 'D:/AKHIL/HP/projects/gamepados/apps/android-client/app/src/main/res';
const STORE = 'D:/AKHIL/HP/projects/gamepados/marketing/store-graphics';
const GLYPH = '<path d="M4 4h7v4H8v8h8v-3h-4V9h8v11H4V4Z"/><path d="M15 4h5v3h-5z"/>';
const ACCENT = '#ff5500', ON = '#09090b';

// shape: 'square' (full bleed), 'rounded' (legacy launcher), 'circle' (legacy round launcher)
function svg(size, shape) {
  const pad = shape === 'square' ? 0 : size / 24;          // legacy icons keep a hair of margin
  const box = size - 2 * pad;
  const bg = shape === 'circle'
    ? `<circle cx="${size / 2}" cy="${size / 2}" r="${box / 2}" fill="${ACCENT}"/>`
    : `<rect x="${pad}" y="${pad}" width="${box}" height="${box}" rx="${shape === 'square' ? 0 : box * 0.22}" fill="${ACCENT}"/>`;
  const g = box * 0.66, o = (size - g) / 2;                  // same proportion as the brand mark
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${bg}
  <g transform="translate(${o} ${o}) scale(${g / 24})" fill="${ON}">${GLYPH}</g></svg>`;
}

const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--force-color-profile=srgb'] });
const page = await browser.newPage();
async function shot(markup, size, file, transparent) {
  await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html><head><style>html,body{margin:0;width:${size}px;height:${size}px;overflow:hidden;background:transparent}</style></head><body>${markup}</body></html>`);
  mkdirSync(path.dirname(file), { recursive: true });
  await page.screenshot({ path: file, omitBackground: transparent, clip: { x: 0, y: 0, width: size, height: size } });
  console.log(file);
}

for (const [dpi, px] of Object.entries({ mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 })) {
  await shot(svg(px, 'rounded'), px, `${RES}/mipmap-${dpi}/ic_launcher.png`, true);
  await shot(svg(px, 'circle'), px, `${RES}/mipmap-${dpi}/ic_launcher_round.png`, true);
}
await shot(svg(512, 'square'), 512, `${STORE}/play-icon-512.png`, false);
await browser.close();
