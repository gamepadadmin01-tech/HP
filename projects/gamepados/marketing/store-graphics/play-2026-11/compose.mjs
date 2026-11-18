// Store screenshots with a headline: raw/<name>.png + captions.<lang>.json -> out/<lang>/<nn>-<name>.png
//
//   node compose.mjs [lang]     (default en; 2.1 adds the other languages with their own captions file and raw shots)
//
// Portrait: 1080x1920. Landscape: 1920x1080. The real app screen sits in a plain phone frame (no brand) under the
// headline, on the app's warm dark brown with one orange accent. Words in {braces} in a title are orange.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire('D:/AKHIL/HP/projects/gamepados/apps/controller-ui/package.json');
const puppeteer = require('puppeteer');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const LANG = process.argv[2] || 'en';
const cap = JSON.parse(fs.readFileSync(path.join(HERE, `captions.${LANG}.json`), 'utf8'));
// SCALE=2 RAW=raw-4k -> 4K store images (2160x3840 / 3840x2160), the largest Google Play accepts
const SCALE = Number(process.env.SCALE || 1);
const RAW = path.join(HERE, process.env.RAW || (LANG === 'en' ? 'raw' : `raw-${LANG}`));
// PHONE=poco: the phone in the picture has the shape of a normal modern Android phone (20:9, POCO X6 Pro), and its
// screens come from raw-poco/ (shoot with PHONE=poco RAW_DIR=raw-poco SCALE=4 node shoot.mjs). The picture itself stays
// 9:16 / 16:9, the shape Google Play recommends for screenshots (Play refuses anything longer than 2:1).
const POCO = process.env.PHONE === 'poco';
const OUT = path.join(HERE, 'out', `${LANG}${SCALE > 1 ? '-4k' : ''}${POCO ? '-poco' : ''}`);
fs.mkdirSync(OUT, { recursive: true });

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const title = (t) => esc(t).replace(/\{([^}]+)\}/g, '<em>$1</em>');

function html(shot, img) {
  const land = shot.shape === 'landscape';
  const W = land ? 1920 : 1080, H = land ? 1080 : 1920;
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@700&family=Inter:wght@500&family=Noto+Sans+SC:wght@500;700&family=Noto+Sans+JP:wght@500;700&family=Noto+Sans+Devanagari:wght@500;700&display=block" rel="stylesheet">
<style>
  * { margin:0; box-sizing:border-box; }
  html, body { width:${W}px; height:${H}px; overflow:hidden; }
  body { background:#1A1210; color:#F6EDE9; font-family:'Inter','Noto Sans SC','Noto Sans JP','Noto Sans Devanagari',sans-serif;
    position:relative; display:flex; ${land ? 'flex-direction:row; align-items:center;' : 'flex-direction:column; align-items:center;'} }
  .glow { position:absolute; inset:0; background:
      radial-gradient(${land ? '900px 700px at 78% 60%' : '1100px 900px at 50% 78%'}, rgba(255,85,0,0.22), transparent 70%),
      radial-gradient(700px 500px at ${land ? '12% 20%' : '10% 6%'}, rgba(255,85,0,0.08), transparent 70%); }
  .copy { position:relative; ${land ? 'width:640px; padding:0 40px 0 110px;' : 'width:100%; padding:130px 90px 0; text-align:center;'} }
  h1 { font-family:'Space Grotesk','Noto Sans SC','Noto Sans JP','Noto Sans Devanagari',sans-serif; font-weight:700;
    font-size:${land ? 76 : 88}px; line-height:1.08; letter-spacing:-0.02em; }
  h1 em { font-style:normal; color:#FF5500; }
  p { margin-top:${land ? 28 : 30}px; font-size:${land ? 34 : 40}px; line-height:1.35; color:#C9BCB6; }
  .phone { position:relative; ${land ? (POCO ? 'margin-left:20px; width:1180px; height:551px;' : 'margin-left:20px; width:1120px; height:630px;')
      : (POCO ? 'margin-top:72px; width:621px; height:1332px;' : 'margin-top:90px; width:740px; height:1316px;')}
    border-radius:${land ? 64 : 72}px; padding:${land ? 18 : 20}px; background:#0C0807;
    box-shadow:0 0 0 2px rgba(255,255,255,0.10), 0 40px 120px rgba(0,0,0,0.65), 0 0 90px rgba(255,85,0,0.18); }
  .phone img { width:100%; height:100%; object-fit:cover; object-position:top; border-radius:${land ? 48 : 54}px; display:block; }
</style></head><body><div class="glow"></div>
  <div class="copy"><h1>${title(shot.title)}</h1><p>${esc(shot.sub)}</p></div>
  <div class="phone"><img src="${img}"></div>
</body></html>`;
}

const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--force-color-profile=srgb'] });
let n = 0;
for (const shot of cap.shots) {
  n++;
  const land = shot.shape === 'landscape';
  const p = await browser.newPage();
  await p.setViewport({ width: land ? 1920 : 1080, height: land ? 1080 : 1920, deviceScaleFactor: SCALE });
  const img = pathToFileURL(path.join(RAW, shot.file + '.png')).href;
  const tmp = path.join(OUT, `_tmp_${shot.file}.html`);
  fs.writeFileSync(tmp, html(shot, img));
  await p.goto(pathToFileURL(tmp).href, { waitUntil: 'networkidle0' });
  await p.evaluate(() => document.fonts.ready);
  const name = `${String(n).padStart(2, '0')}-${shot.file}-${land ? `${1920 * SCALE}x${1080 * SCALE}` : `${1080 * SCALE}x${1920 * SCALE}`}.png`;
  await p.screenshot({ path: path.join(OUT, name) });
  fs.unlinkSync(tmp);
  console.log(`out/${LANG}/${name}`);
  await p.close();
}
await browser.close();
