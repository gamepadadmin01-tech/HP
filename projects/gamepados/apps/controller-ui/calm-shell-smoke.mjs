// Local built-bundle checks. Native calls are spies; external traffic is blocked.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import puppeteer from 'puppeteer';

const html = fs.readFileSync(new URL('./dist/index.html', import.meta.url));
const artifacts = new URL('../../docs/ui-redesign-research-2026-09-16/implementation/', import.meta.url);
fs.mkdirSync(artifacts, {recursive:true});
const server = http.createServer((req,res) => {res.setHeader('Content-Type','text/html');res.end(html);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
let browser;
const results=[];
try {
  browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  const p=await browser.newPage(), errors=[];
  p.on('pageerror',e=>errors.push(e.message));
  await p.setRequestInterception(true);
  p.on('request',r=>r.url().startsWith(origin+'/')?r.continue():r.abort());
  await p.evaluateOnNewDocument(()=>{
    localStorage.setItem('feature_rated_v2','1');
    window.testTel={linkAlive:false,engineRunning:false}; window.testCalls=[];
    window.AndroidBridge={
      getNetworkTelemetryJson:()=>JSON.stringify(window.testTel),
      connectToPC:(...args)=>window.testCalls.push(['connect',...args]),
      startCameraScan:()=>window.testCalls.push(['camera-start']),
      stopCameraScan:()=>window.testCalls.push(['camera-stop']),
    };
  });
  const settle=()=>new Promise(r=>setTimeout(r,650));
  const click=async text=>{await p.evaluate(t=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===t);if(!b)throw Error('Missing button: '+t);b.click();},text);await settle();};
  const shot=async name=>p.screenshot({path:new URL(name+'.png',artifacts).pathname.replace(/^\/(\w:)/,'$1')});
  const fits=async label=>assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,label);
  await p.setViewport({width:412,height:915,deviceScaleFactor:1});
  await p.goto(origin);await settle();
  await shot('home-dark');
  await p.click('[aria-label="Use light appearance"]');await settle();await shot('home-light');
  await p.reload();await settle();
  assert.equal(await p.$eval('.gp-dashboard',e=>e.dataset.calmTheme),'light');
  for (const [state,tel,title] of [
    ['off',{linkAlive:false,engineRunning:false},'Connect your PC'],
    ['no-reply',{engineRunning:true,sinceAck:-1},'PC not replying'],
    ['stalled',{engineRunning:true,sinceAck:5000},'Connection interrupted'],
    ['connected',{linkAlive:true,connectionType:'wireless'},'PC connected'],
  ]) {
    await p.evaluate(t=>window.testTel=t,tel);
    await p.waitForSelector(`[data-link-state="${state}"]`);
    assert.ok(await p.$eval('.calm-connection',e=>e.innerText).then(t=>t.includes(title)));
  }
  results.push('Theme persists; four real link states remain distinct');
  await p.evaluate(()=>window.testTel={linkAlive:false,engineRunning:false});await settle();
  await p.click('.calm-connection');await settle();await shot('connect-wifi-light');
  assert.equal(await p.$eval('.gp-connect',e=>e.dataset.calmTheme),'light');
  await click('USB');await click('Debugging');
  assert.equal(await p.evaluate(()=>localStorage.getItem('gp_wired_pref')),'usbdebug');
  assert.ok(await p.evaluate(()=>document.body.innerText.includes('Allow USB debugging')));
  await click('Tethering');assert.ok(await p.evaluate(()=>document.body.innerText.includes('Turn on USB tethering')));
  await click('Auto');await shot('connect-usb-light');
  await click('Wi-Fi');await click('Enter connection details manually');await click('Connect');
  assert.ok(await p.$('[role="alert"]'));assert.deepEqual(await p.evaluate(()=>window.testCalls.filter(c=>c[0]==='connect')),[]);
  await p.type('#calm-pc-ip','192.168.1.10');await click('Connect');
  assert.deepEqual(await p.evaluate(()=>window.testCalls.filter(c=>c[0]==='connect')),[['connect','192.168.1.10',7777,'manual']]);
  assert.ok(await p.$('.gp-dashboard'));
  results.push('USB modes persist with correct instructions; invalid manual input rejected; valid input calls existing bridge');
  await p.click('.calm-connection');await settle();await click('Scan PC QR code');
  assert.ok(await p.$('.scanner-overlay-active'));
  assert.equal(await p.$eval('.gp-connect',e=>getComputedStyle(e).backgroundColor),'rgba(0, 0, 0, 0)');
  assert.ok(await p.evaluate(()=>window.testCalls.some(c=>c[0]==='camera-start')));
  await p.click('.scanner-overlay-active button');await settle();
  assert.ok(await p.evaluate(()=>window.testCalls.some(c=>c[0]==='camera-stop')));
  results.push('QR overlay starts/stops existing camera bridge; background stays transparent');
  await click('Scan PC QR code');
  await p.evaluate(()=>window.onQRScanned('not-a-server-code'));await settle();
  assert.ok(await p.evaluate(()=>document.body.innerText.includes('Pairing failed')));
  await click('Cancel');await click('Scan PC QR code');
  await p.evaluate(()=>window.onQRScanned('192.168.1.11,7777,a1b2c3d4'));await settle();
  assert.ok(await p.$('.scanner-overlay-active'),'QR must await acknowledgement');
  await p.evaluate(()=>window.testTel={linkAlive:true,connectionType:'wireless'});
  await p.waitForSelector('.gp-dashboard');await settle();
  assert.ok(await p.evaluate(()=>window.testCalls.some(c=>c[0]==='connect'&&c[1]==='192.168.1.11'&&c[3]==='a1b2c3d4')));
  await p.click('.calm-connection');await settle();
  results.push('Invalid QR remains an error; valid QR returns to Play only after mocked PC acknowledgement');
  for (const [width,height] of [[320,640],[412,915],[768,1024],[1280,800],[915,412]]) {
    await p.setViewport({width,height,deviceScaleFactor:1});await settle();await fits(`Connect ${width}`);
    await click('Back to Play');await fits(`Home ${width}`);
    if(width===768)await shot('home-tablet');
    await p.click('.calm-connection');await settle();
  }
  results.push('Home and Connect fit five phone/tablet/landscape viewports');
  await p.setViewport({width:412,height:915,deviceScaleFactor:1});await click('Back to Play');
  await click('Settings');assert.ok(await p.$('.calm-legacy-content'));await click('Account');assert.ok(await p.$('.calm-legacy-content'));await click('Play');
  await p.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
  assert.equal(await p.$eval('.calm-tab-enter',e=>getComputedStyle(e).animationName),'none');
  await p.click('.calm-create-layout');await settle();
  assert.ok(await p.evaluate(()=>document.body.innerText.includes('Import from Code')));
  results.push('Settings/account routes, reduced motion and existing layout wizard reachable');
  // Isolated browser fixture: never uses the owner's phone storage or cloud data.
  await p.evaluate(()=>localStorage.setItem('custom_pads',JSON.stringify([{padId:'calm-fixture',name:'My racing pad',color:'#5D90CB',buttons:[]}])));
  await p.reload();await settle();
  assert.equal(await p.$$eval('.calm-controller-card',es=>es.length),2);
  await p.click('[aria-label="Select My racing pad"]');await settle();
  assert.equal(await p.$eval('.calm-controller-card',e=>e.querySelector('.calm-card-name').textContent),'My racing pad');
  await p.click('[aria-label="More options for My racing pad"]');await click('◫ Duplicate');
  assert.equal(await p.$$eval('.calm-controller-card',es=>es.length),3);
  await p.click('[aria-label="More options for My racing pad"]');await click('🗑 Delete');await click('CANCEL');
  assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem('custom_pads')).length),2);
  await click('🗑 Delete');await click('DELETE');
  assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem('custom_pads')).length),1);
  results.push('Saved layout selection, duplicate, delete cancellation and confirmed deletion work in isolated fixture');
  assert.deepEqual(errors,[]);
  fs.writeFileSync(new URL('validation.json',artifacts),JSON.stringify({testedAt:new Date().toISOString(),results,errors,nativeHardwareTested:false},null,2));
  results.forEach(r=>console.log('PASS '+r));
} finally {if(browser)await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
