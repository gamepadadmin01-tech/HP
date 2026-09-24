// Local-only smoke test. All external requests are mocked or blocked; no account
// changes, purchases, screenshots or production traffic are performed.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import puppeteer from 'puppeteer';

const html = fs.readFileSync(new URL('./dist/index.html', import.meta.url));
const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html'); res.end(html);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setRequestInterception(true);
  page.on('request', req => {
    if (req.url().startsWith(origin + '/')) return req.continue();
    if (req.url().includes('/api/billing/plans')) return req.respond({
      status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ success: true, channel: 'direct', currency: 'INR', purchasable: true,
        plans: [{ code: 'THREE_DAY', displayName: '3 Days', currency: 'INR', priceMinor: 4900,
          unlimited: true, dailySeconds: null, durationHours: 72, durationMonths: null,
          purchasable: true, priceFromStore: false }] }),
    });
    return req.abort();
  });
  const settle = () => new Promise(resolve => setTimeout(resolve, 800));
  for (const [width, height] of [[412, 915], [1280, 800], [800, 1280], [600, 800]]) {
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.goto(origin); await settle();
    await page.waitForFunction(() => [...document.querySelectorAll('button')]
      .some(b => b.textContent.trim() === 'Open controller'));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    assert.equal(overflow, false, `Dashboard horizontal overflow at ${width}x${height}`);
    await page.evaluate(() => [...document.querySelectorAll('button')]
      .find(b => b.textContent.trim() === 'Open controller').click());
    await page.waitForSelector('.guest-trial-pill'); await settle();
    assert.equal(await page.$('input[type=password]'), null, 'Guest controller requires sign-in');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
      false, `Controller horizontal overflow at ${width}x${height}`);
    console.log(`PASS dashboard/controller ${width}x${height}`);
  }
  await page.reload(); await settle();
  assert.equal(await page.evaluate(() => document.body.innerText.includes('Pick a controller and play')),
    false, 'Introduction reappeared');
  await page.evaluate(() => [...document.querySelectorAll('button')]
    .find(b => b.textContent.trim() === 'Account').click()); await settle();
  assert.equal(await page.$('input[type=password]'), null, 'Plans require premature sign-in');
  await page.evaluate(() => [...document.querySelectorAll('button')]
    .find(b => b.textContent.includes('Get 3 Days')).click());
  await page.waitForSelector('input[type=password]');
  console.log('PASS one-time introduction and purchase selection opens sign-in');
  await page.evaluate(() => localStorage.setItem('gp_guest_trial_preview', JSON.stringify({
    used: 1798, resetsAt: Date.now() + 3600000,
  })));
  await page.reload(); await settle();
  await page.evaluate(() => [...document.querySelectorAll('button')]
    .find(b => b.textContent.trim() === 'Open controller').click());
  await page.waitForSelector('.guest-trial-pill');
  await page.waitForFunction(() => document.body.innerText.includes("Today's free time is used"),
    { timeout: 8000 });
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('gp_guest_trial_preview')).used),
    1800, 'Guest expiry was not persisted');
  console.log('PASS guest quota expiry persists and opens plans (browser fallback only)');
  assert.deepEqual(errors, []);
} finally {
  if (browser) await browser.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
