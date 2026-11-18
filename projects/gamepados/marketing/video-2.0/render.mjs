// Records scene.html frame by frame and encodes it with ffmpeg (2026-11-18).
//
//   node render.mjs play                 -> out/GamepadOS-2.0-preview-4k60.mp4 (video only; make.mjs adds music)
//   node render.mjs play --scale 0.5     -> a quick 960x540 check
//   node render.mjs play --stills 2,5.2,9,14.3   -> out/stills/*.png, single frames to look at
//   node render.mjs web | webp           -> the website loop (landscape | portrait)
//   options: --lang en  --fps 60  --scale 2  --out <file>
//
// Frames are exact: render(t) is a pure function of time, so a slow frame never stutters the video.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire('D:/AKHIL/HP/projects/gamepados/apps/controller-ui/package.json');
const puppeteer = require('puppeteer');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const MODE = args[0] || 'play';
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const LANG = opt('lang', 'en');
const FPS = Number(opt('fps', 60));
const SCALE = Number(opt('scale', 2));
const STILLS = opt('stills', '');
const W = MODE === 'webp' ? 1080 : 1920, H = MODE === 'webp' ? 1920 : 1080;
const OUT = path.join(HERE, 'out');
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true, args: ['--force-color-profile=srgb', '--allow-file-access-from-files', '--disable-gpu-vsync'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('pageerror:', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('console:', m.text()); });
await page.setViewport({ width: W, height: H, deviceScaleFactor: SCALE });
await page.goto(pathToFileURL(path.join(HERE, 'scene.html')).href + `?mode=${MODE}&lang=${LANG}`, { waitUntil: 'networkidle0' });
await page.evaluate(() => window.ready);
const DURATION = await page.evaluate(() => window.DURATION);
const shot = (type) => page.screenshot({ type, quality: type === 'jpeg' ? 95 : undefined, optimizeForSpeed: true, clip: { x: 0, y: 0, width: W, height: H } });

if (STILLS) {
  const dir = path.join(OUT, 'stills'); fs.mkdirSync(dir, { recursive: true });
  for (const s of STILLS.split(',')) {
    await page.evaluate((t) => window.render(t), Number(s));
    fs.writeFileSync(path.join(dir, `${MODE}-${s}.png`), await shot('png'));
    console.log(`stills/${MODE}-${s}.png`);
  }
  await browser.close(); process.exit(0);
}

const px = `${Math.round(W * SCALE)}x${Math.round(H * SCALE)}`;
const name = opt('out', path.join(OUT, MODE === 'play' ? `video-only-${LANG}-${px}.mp4` : `web-${MODE}-${px}.mp4`));
const big = W * SCALE * H * SCALE >= 3840 * 2160 * 0.9;
const ff = spawn('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error',
  '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
  '-c:v', 'h264_nvenc', '-preset', 'p7', '-tune', 'hq', '-rc', 'vbr', '-cq', '16',
  '-b:v', big ? '70M' : '20M', '-maxrate', big ? '100M' : '30M', '-bufsize', big ? '140M' : '40M',
  '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-movflags', '+faststart', name], { stdio: ['pipe', 'inherit', 'inherit'] });

const N = Math.round(DURATION * FPS);
const t0 = Date.now();
for (let f = 0; f < N; f++) {
  await page.evaluate((t) => window.render(t), f / FPS);
  const buf = await shot('jpeg');
  if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
  if (f % (FPS * 2) === 0) {
    const el = (Date.now() - t0) / 1000, left = f ? (el / f) * (N - f) : 0;
    console.log(`frame ${f}/${N}  ${el.toFixed(0)}s elapsed, ~${left.toFixed(0)}s left`);
  }
}
ff.stdin.end();
await new Promise((r) => ff.on('close', r));
await browser.close();
console.log('done:', name, `${((Date.now() - t0) / 1000).toFixed(0)}s`);
