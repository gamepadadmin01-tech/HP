// Play Store feature graphic, 1024x500, no transparency (Play rejects alpha). 2026-10-01.
//   node feature.mjs   -> feature-graphic-1024x500.png
// Uses the app's own font and brand mark, and the real controller screenshot from shoot.mjs.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire('D:/AKHIL/HP/projects/gamepados/apps/controller-ui/package.json');
const puppeteer = require('puppeteer-core');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const FONT = fs.readFileSync('D:/AKHIL/HP/projects/gamepados/apps/controller-ui/src/assets/space-semibold.woff2').toString('base64');
const SHOT = fs.readFileSync(path.join(HERE, '02-controller-1920x1080.png')).toString('base64');
const GLYPH = '<path d="M4 4h7v4H8v8h8v-3h-4V9h8v11H4V4Z"/><path d="M15 4h5v3h-5z"/>';

const html = `<!doctype html><html><head><style>
@font-face{font-family:'GP';src:url(data:font/woff2;base64,${FONT}) format('woff2');font-weight:600}
html,body{margin:0;width:1024px;height:500px;overflow:hidden}
body{background:radial-gradient(120% 140% at 85% 50%,#2a1206 0%,#0b0b0d 55%,#09090b 100%);font-family:'GP',sans-serif;color:#fafafa;position:relative}
.glow{position:absolute;right:-120px;top:-60px;width:620px;height:620px;border-radius:50%;background:radial-gradient(circle,#ff550055 0%,#ff550000 65%)}
.left{position:absolute;left:56px;top:0;bottom:0;width:430px;display:flex;flex-direction:column;justify-content:center}
.brand{display:flex;align-items:center;gap:14px;margin-bottom:30px}
.mark{width:52px;height:52px;border-radius:13px;background:#ff5500;display:grid;place-items:center}
.word{font-size:34px;letter-spacing:-1.6px}.word i{font-style:normal;color:#a1a1aa}.word b{color:#ff5500;font-weight:600}
h1{margin:0;font-size:46px;line-height:1.02;letter-spacing:-2.2px;font-weight:600}
h1 span{color:#ff5500}
p{margin:18px 0 0;font-size:17px;color:#c4c4cc;letter-spacing:-.2px;line-height:1.4}
.phone{position:absolute;right:34px;top:118px;width:430px;height:242px;border-radius:34px;background:#000;padding:10px;
  box-shadow:0 0 0 2px #2b2b30,0 30px 60px #000c,0 0 80px #ff550033;transform:rotate(-4deg)}
.phone img{width:100%;height:100%;border-radius:25px;display:block}
</style></head><body>
<div class="glow"></div>
<div class="left">
  <div class="brand"><div class="mark"><svg width="34" height="34" viewBox="0 0 24 24" fill="#09090b">${GLYPH}</svg></div>
    <div class="word">gamepad<i>os</i><b>.</b></div></div>
  <h1>Your phone is<br>your <span>PC controller.</span></h1>
  <p>Wi-Fi or USB · Gyro steering · Your own layouts</p>
</div>
<div class="phone"><img src="data:image/png;base64,${SHOT}"></div>
</body></html>`;

const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--force-color-profile=srgb'] });
const page = await browser.newPage();
await page.setViewport({ width: 1024, height: 500, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: path.join(HERE, 'feature-graphic-1024x500.png'), omitBackground: false, clip: { x: 0, y: 0, width: 1024, height: 500 } });
await browser.close();
console.log('feature-graphic-1024x500.png');
