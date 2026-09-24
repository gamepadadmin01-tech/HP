import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const out = new URL('../../docs/manual-redeem-2026-09-21/', import.meta.url);
fs.mkdirSync(out, {recursive:true});
const browser = await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const page = await browser.newPage();
const errors=[]; page.on('pageerror',e=>errors.push(e.message));
const pause=()=>new Promise(r=>setTimeout(r,700));
const click=async s=>{await page.click(s);await pause()};
const shot=async name=>page.screenshot({path:new URL(name+'.png',out).pathname.replace(/^\/(\w:)/,'$1'),fullPage:true});
try {
 await page.setViewport({width:412,height:915,deviceScaleFactor:3});
 await page.setRequestInterception(true);
 page.on('request',r=>r.url().startsWith('http://127.0.0.1:5187/')||r.url().startsWith('data:')?r.continue():r.abort());
 await page.evaluateOnNewDocument(()=>{
  window.calls=[]; window.AndroidBridge={getNetworkTelemetryJson:()=>JSON.stringify({engineRunning:false,linkAlive:false}),getUsbBroadcastAddress:()=>'',stopEngine(){},connectToPC:(...args)=>window.calls.push(args)};
 });
 await page.goto('http://127.0.0.1:5187/'); await pause();
 await shot('01-home');
 await click('[data-testid="nav-system-button"]'); await shot('02-settings');
 await click('[data-testid="nav-account-button"]'); await shot('03-plans-offline');
 await click('[data-testid="profile-shortcut-button"]'); await shot('04-sign-in');
 await page.reload();await pause();
 await click('[data-testid="nav-home-button"]');
 await click('[data-testid="connect-pc-button"]');await shot('05-connect-wifi');
 await click('[data-testid="connection-usb-button"]');await shot('06-connect-usb');
 await click('[data-testid="connection-wireless-button"]');
 await click('[data-testid="manual-entry-toggle-button"]');
 await page.type('#calm-pc-ip','192.168.1.10');
 await click('[data-testid="manual-connect-button"]');
 assert.equal(await page.evaluate(()=>window.calls.length),0,'Missing key must not connect');
 await page.type('#calm-pc-key','Z1234567');await click('[data-testid="manual-connect-button"]');
 assert.equal(await page.evaluate(()=>window.calls.length),0,'Non-hex key must not connect');
 await page.$eval('#calm-pc-key',e=>e.select());await page.type('#calm-pc-key','A1B2C3D4');
 await shot('07-manual-pairing');
 await click('[data-testid="manual-connect-button"]');
 assert.deepEqual(await page.evaluate(()=>window.calls),[['192.168.1.10',7777,'a1b2c3d4']]);
 for(const plan of ['FREE','LIFETIME']) {
  await page.evaluate(plan=>{
   const user={email:'player@example.com',displayName:'Player'};
   localStorage.setItem('gp_account',JSON.stringify({token:'local-ui-fixture',user}));
   const unlimited=plan==='LIFETIME';
   localStorage.setItem('gp_billing',JSON.stringify({email:user.email,catalogue:null,entitlement:{plan,unlimited,startsAt:null,endsAt:null,autoRenew:false,source:'PURCHASE',today:{limitSeconds:unlimited?null:3600,usedSeconds:0,remainingSeconds:unlimited?null:3600},resetsAt:'2099-01-01T00:00:00Z',resetTimezone:'Asia/Kolkata',heartbeatSeconds:30,serverTime:new Date().toISOString()}}));
   localStorage.setItem('gp_dashboard_tab','account');
  },plan);
  await page.reload();await pause();
  await click('[data-testid="nav-account-button"]');
  if(plan==='FREE') {
   await page.waitForSelector('[aria-label="Promo code"]');
   await page.focus('[aria-label="Promo code"]');await pause();
   assert.equal(await page.$eval('[aria-label="Promo code"]',e=>getComputedStyle(e).outlineStyle),'none');
   assert.equal(await page.$eval('.calm-promo-field',e=>getComputedStyle(e).outlineStyle),'solid');
   await shot('08-redeem-focused');
  } else {
   assert.equal(await page.$('[aria-label="Promo code"]'),null,'Lifetime must not offer redemption');
   await shot('09-lifetime-profile');
  }
 }
 assert.deepEqual(errors,[]);
 fs.writeFileSync(new URL('checks.json',out),JSON.stringify({passed:['Manual requires valid key','Manual passes actual key and default port','Rounded wrapper receives focus; input has no rectangular outline','Lifetime redemption hidden','No runtime errors'],screenshots:'3x browser captures; synthetic account data; no phone camera or purchases exercised'},null,2));
 console.log('PASS manual pairing and redeem browser checks');
} finally {await browser.close()}
