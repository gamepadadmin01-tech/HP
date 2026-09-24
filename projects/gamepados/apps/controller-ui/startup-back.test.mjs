import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const page=await browser.newPage(); const errors=[];page.on('pageerror',e=>errors.push(e.message));
const pause=()=>new Promise(r=>setTimeout(r,650));
const click=async s=>{await page.click(s);await pause()};
const back=async()=>{await page.evaluate(()=>window.handleAndroidBack());await pause()};
try {
 await page.setViewport({width:412,height:915});
 await page.setRequestInterception(true);page.on('request',r=>r.url().startsWith('http://127.0.0.1:5187/')||r.url().startsWith('data:')?r.continue():r.abort());
 await page.evaluateOnNewDocument(()=>{
  localStorage.setItem('gp_dashboard_tab','account');
  window.samples=[];window.exits=0;window.readyAt=0;
  window.AndroidBridge={onUiReady:()=>window.readyAt=performance.now(),exitApp:()=>window.exits++,getNetworkTelemetryJson:()=>JSON.stringify({engineRunning:false,linkAlive:false}),getUsbBroadcastAddress:()=>'',stopEngine(){},startCameraScan(){},stopCameraScan(){}};
  const sample=()=>{const el=document.querySelector('[data-testid="dashboard-screen-transition"]');if(el)window.samples.push([performance.now(),Number(getComputedStyle(el).opacity)]);if(window.samples.length<90)requestAnimationFrame(sample)};requestAnimationFrame(sample);
 });
 await page.goto('http://127.0.0.1:5187/');await page.waitForSelector('[data-testid="home-heading"]');await pause();
 const first=await page.evaluate(()=>({samples:window.samples,ready:window.readyAt}));
 assert.ok(first.ready>0,'Painted UI signals native splash readiness');
 assert.ok(first.samples.every(([,opacity])=>opacity===1),'Native splash reveals stable Home with no second page entrance');
 await click('[data-testid="nav-system-button"]');await click('[data-testid="nav-account-button"]');await back();
 assert.ok(await page.$('[data-testid="settings-heading"]'),'Back returns to previous tab');await back();assert.ok(await page.$('[data-testid="home-heading"]'));
 await click('[data-testid="profile-shortcut-button"]');await click('[data-testid="auth-forgot-password-button"]');await back();assert.ok(await page.$('[data-testid="auth-signin-form"]'));await back();assert.ok(await page.$('[data-testid="home-heading"]'));
 await click('[data-testid="create-layout-button"]');await back();assert.equal(await page.$('[role="dialog"][aria-label="Create or import a layout"]'),null);
 await page.$eval('button[aria-label^="Play "]',e=>e.click());await pause();await back();assert.ok(await page.$('[data-testid="home-heading"]'),'Controller Back returns to Play');
 await click('[data-testid="create-layout-button"]');
 await page.evaluate(()=>[...document.querySelectorAll('button')].find(e=>e.textContent.includes('Blank Canvas')).click());await pause();
 await page.type('input[placeholder="My Custom Layout"]','Back test');
 await page.evaluate(()=>[...document.querySelectorAll('button')].find(e=>e.textContent.includes('CREATE & OPEN EDITOR')).click());await pause();
 await page.waitForSelector('[data-testid="editor-back-button"]');await back();assert.equal(await page.$('[data-testid="editor-back-button"]'),null,'Unchanged editor closes without losing existing layouts');
 await click('[data-testid="connect-pc-button"]');await click('[data-testid="scan-qr-button"]');await back();assert.ok(await page.$('[data-testid="connect-heading"]'));await back();assert.ok(await page.$('[data-testid="home-heading"]'));
 await back();assert.equal(await page.evaluate(()=>window.exits),1,'Back on Home backgrounds app');assert.equal(await page.$('[data-testid="connect-heading"]'),null);
 await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);await page.reload();await page.waitForSelector('[data-testid="home-heading"]');await pause();assert.ok(await page.evaluate(()=>window.samples.every(([,opacity])=>opacity===1)),'Reduced motion is respected');
 assert.deepEqual(errors,[]);console.log('PASS single native startup reveal, default Home, previous-tab Back, auth Back, modal Back, camera/Connect Back, Home exit, reduced motion');
}finally{await browser.close()}
