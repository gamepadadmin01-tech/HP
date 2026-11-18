// Play feature graphic (1024x500) for 2.0: the headline on the left, the real controller screen on the right.
//   node feature.mjs [lang]  -> out/<lang>/feature-graphic-1024x500.png
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire('D:/AKHIL/HP/projects/gamepados/apps/controller-ui/package.json');
const puppeteer = require('puppeteer');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const LANG = process.argv[2] || 'en';
const TEXT = {
  en: { title: 'Turn your phone into a {PC gamepad}', sub: 'Wi-Fi or USB · Low latency · No dongle' },
}[LANG];
const OUT = path.join(HERE, 'out', LANG);
fs.mkdirSync(OUT, { recursive: true });
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const img = pathToFileURL(path.join(HERE, process.env.RAW || (LANG === 'en' ? 'raw' : `raw-${LANG}`), 'controller.png')).href;
const icon = pathToFileURL(path.join(HERE, '..', 'play-icon-512.png')).href;

const html = `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@700&family=Inter:wght@500&display=block" rel="stylesheet">
<style>
  * { margin:0; box-sizing:border-box; }
  html, body { width:1024px; height:500px; overflow:hidden; }
  body { background:#1A1210; color:#F6EDE9; font-family:'Inter',sans-serif; position:relative; }
  .glow { position:absolute; inset:0; background: radial-gradient(520px 420px at 78% 58%, rgba(255,85,0,0.26), transparent 70%),
    radial-gradient(380px 300px at 8% 10%, rgba(255,85,0,0.10), transparent 70%); }
  .copy { position:absolute; left:64px; top:0; bottom:0; width:400px; display:flex; flex-direction:column; justify-content:center; }
  .brand { display:flex; align-items:center; gap:14px; margin-bottom:26px; font-family:'Space Grotesk',sans-serif; font-weight:700; font-size:26px; }
  .brand img { width:52px; height:52px; border-radius:14px; }
  h1 { font-family:'Space Grotesk',sans-serif; font-weight:700; font-size:42px; line-height:1.1; letter-spacing:-0.02em; }
  h1 em { font-style:normal; color:#FF5500; }
  p { margin-top:18px; font-size:19px; color:#C9BCB6; }
  .phone { position:absolute; right:-120px; top:78px; width:600px; height:338px; border-radius:40px; padding:11px; background:#0C0807;
    box-shadow:0 0 0 2px rgba(255,255,255,0.10), 0 30px 80px rgba(0,0,0,0.6), 0 0 70px rgba(255,85,0,0.2); }
  .phone img { width:100%; height:100%; object-fit:cover; border-radius:30px; display:block; }
</style></head><body><div class="glow"></div>
  <div class="copy"><div class="brand"><img src="${icon}">GamepadOS</div>
    <h1>${esc(TEXT.title).replace(/\{([^}]+)\}/g, '<em>$1</em>')}</h1><p>${esc(TEXT.sub)}</p></div>
  <div class="phone"><img src="${img}"></div>
</body></html>`;

const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--force-color-profile=srgb'] });
const p = await browser.newPage();
await p.setViewport({ width: 1024, height: 500, deviceScaleFactor: Number(process.env.SCALE || 1) });   // SCALE=4: drawn 4x, shrunk by finish.py for crisp edges
const tmp = path.join(OUT, '_feature.html');
fs.writeFileSync(tmp, html);
await p.goto(pathToFileURL(tmp).href, { waitUntil: 'networkidle0' });
await p.evaluate(() => document.fonts.ready);
await p.screenshot({ path: path.join(OUT, process.env.SCALE > 1 ? 'feature-graphic-hires.png' : 'feature-graphic-1024x500.png') });
fs.unlinkSync(tmp);
console.log(`out/${LANG}/feature-graphic-1024x500.png`);
await browser.close();
