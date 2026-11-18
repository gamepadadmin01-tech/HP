// Feature graphic, round 2 (2026-11-18): three designs to choose from.
//   node feature2.mjs  -> out/en/feature-options/feature-<a|b|c>-hires.png (4096x2000; finish.py shrinks to 1024x500)
//
// Google Play puts a play button in the CENTRE of the feature graphic when the listing has a video, and may crop the
// edges, so the text sits on the left, the phone on the right, and the middle stays calm.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire('D:/AKHIL/HP/projects/gamepados/apps/controller-ui/package.json');
const puppeteer = require('puppeteer');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'out', 'en', 'feature-options');
fs.mkdirSync(OUT, { recursive: true });
const u = (f) => pathToFileURL(path.join(HERE, f)).href;
const ICON = u('../play-icon-512.png'), CTRL = u('raw-poco/controller.png'), GAME = u('raw-4k/game.png');   // controller: 20:9, a normal Android phone's shape

const BASE = `
  * { margin:0; box-sizing:border-box; }
  html, body { width:1024px; height:500px; overflow:hidden; }
  body { background:#1A1210; color:#F6EDE9; font-family:'Inter',sans-serif; position:relative; }
  .brand { display:flex; align-items:center; gap:12px; font-family:'Space Grotesk',sans-serif; font-weight:700; font-size:24px; }
  .brand img { width:46px; height:46px; border-radius:12px; }
  h1 { font-family:'Space Grotesk',sans-serif; font-weight:700; letter-spacing:-0.025em; line-height:1.02; }
  h1 em { font-style:normal; color:#FF5500; }
  .sub { font-size:18px; color:#C9BCB6; font-weight:500; }
  .phone { position:absolute; background:#0C0807; border-radius:34px; padding:10px;
    box-shadow:0 0 0 1.5px rgba(255,255,255,0.12), 0 30px 70px rgba(0,0,0,0.7), 0 0 60px rgba(255,85,0,0.22); }
  .phone img { display:block; width:100%; height:100%; object-fit:cover; border-radius:25px; }
`;

const DESIGNS = {
  // A: calm brand look, the whole phone visible, tilted, on the right
  a: `<style>${BASE}
    .glow { position:absolute; inset:0; background: radial-gradient(460px 360px at 76% 55%, rgba(255,85,0,0.30), transparent 70%),
      radial-gradient(300px 240px at 6% 10%, rgba(255,85,0,0.10), transparent 70%); }
    .copy { position:absolute; left:58px; top:0; bottom:0; width:390px; display:flex; flex-direction:column; justify-content:center; gap:22px; }
    h1 { font-size:52px; }
    .phone { left:548px; top:118px; width:440px; height:209px; transform:rotate(-7deg); }
  </style><div class="glow"></div>
  <div class="copy"><div class="brand"><img src="${ICON}">GamepadOS</div>
    <h1>Your phone is a <em>PC gamepad</em></h1><div class="sub">Wi-Fi or USB · Low latency · No dongle</div></div>
  <div class="phone"><img src="${CTRL}"></div>`,

  // B: the PC and the phone together, like the video (game on a monitor, phone in front)
  b: `<style>${BASE}
    .glow { position:absolute; inset:0; background: radial-gradient(520px 380px at 74% 50%, rgba(255,85,0,0.24), transparent 70%); }
    .copy { position:absolute; left:58px; top:0; bottom:0; width:400px; display:flex; flex-direction:column; justify-content:center; gap:20px; }
    h1 { font-size:54px; }
    .mon { position:absolute; left:560px; top:62px; width:420px; height:247px; padding:9px; border-radius:14px; background:#0B0706;
      box-shadow:0 0 0 1.5px rgba(255,255,255,0.08), 0 30px 70px rgba(0,0,0,0.6); }
    .mon img { width:100%; height:100%; display:block; border-radius:5px; object-fit:cover; }
    .neck { position:absolute; left:745px; top:309px; width:50px; height:34px; background:linear-gradient(#0B0706,#1d1411); }
    .foot { position:absolute; left:695px; top:343px; width:150px; height:8px; border-radius:5px; background:#221815; }
    .phone { left:684px; top:286px; width:290px; height:139px; padding:8px; border-radius:26px; transform:rotate(-6deg); }
    .phone img { border-radius:19px; }
  </style><div class="glow"></div>
  <div class="copy"><div class="brand"><img src="${ICON}">GamepadOS</div>
    <h1>Play PC games <em>with your phone</em></h1><div class="sub">Wi-Fi or USB · Low latency · No dongle</div></div>
  <div class="mon"><img src="${GAME}"></div><div class="neck"></div><div class="foot"></div>
  <div class="phone"><img src="${CTRL}"></div>`,

  // C: cinematic: the game fills the picture, dark on the left for the words, the phone in front on the right
  c: `<style>${BASE}
    body { background:#0c0607; }
    .bg { position:absolute; left:300px; top:-6px; width:860px; height:484px; background:url(${GAME}) center / cover no-repeat; }
    .shade { position:absolute; inset:0; background: linear-gradient(90deg, #140D0B 0%, #140D0B 30%, rgba(20,13,11,0.55) 50%, rgba(20,13,11,0.0) 72%),
      linear-gradient(0deg, rgba(12,6,7,1) 0%, rgba(12,6,7,0) 30%); }
    .copy { position:absolute; left:58px; top:0; bottom:0; width:390px; display:flex; flex-direction:column; justify-content:center; gap:22px; }
    h1 { font-size:52px; text-shadow:0 4px 30px rgba(0,0,0,0.5); }
    .phone { left:650px; top:272px; width:330px; height:158px; padding:9px; border-radius:28px; transform:rotate(-8deg); }
    .phone img { border-radius:20px; }
  </style><div class="bg"></div><div class="shade"></div>
  <div class="copy"><div class="brand"><img src="${ICON}">GamepadOS</div>
    <h1>Your phone is a <em>PC gamepad</em></h1><div class="sub">Wi-Fi or USB · Low latency · No dongle</div></div>
  <div class="phone"><img src="${CTRL}"></div>`,
};

const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--force-color-profile=srgb'] });
for (const [k, body] of Object.entries(DESIGNS)) {
  const p = await browser.newPage();
  await p.setViewport({ width: 1024, height: 500, deviceScaleFactor: 4 });
  const tmp = path.join(OUT, `_f${k}.html`);
  fs.writeFileSync(tmp, `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@700&family=Inter:wght@500&display=block" rel="stylesheet"></head><body>${body}</body></html>`);
  await p.goto(pathToFileURL(tmp).href, { waitUntil: 'networkidle0' });
  await p.evaluate(() => document.fonts.ready);
  await p.screenshot({ path: path.join(OUT, `feature-${k}-hires.png`) });
  fs.unlinkSync(tmp); await p.close();
  console.log(`feature-${k}`);
}
await browser.close();
