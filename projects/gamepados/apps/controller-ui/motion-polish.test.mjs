import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const p=await browser.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
try {
 await p.setViewport({width:412,height:915});
 await p.setRequestInterception(true);p.on('request',r=>r.url().startsWith('http://127.0.0.1:5187/')||r.url().startsWith('data:')?r.continue():r.abort());
 await p.evaluateOnNewDocument(()=>{localStorage.setItem('custom_pads',JSON.stringify([{padId:'motion-fixture',name:'Motion layout',buttons:[],color:'#00bbff'}])); window.AndroidBridge={onUiReady(){},getNetworkTelemetryJson:()=>JSON.stringify({engineRunning:false,linkAlive:false}),getUsbBroadcastAddress:()=>'',stopEngine(){}};});
 await p.goto('http://127.0.0.1:5187/');await p.waitForSelector('.calm-controller-card');await wait(600);
 const geometry=()=>p.$$eval('.calm-card-name',es=>es.map(e=>{const r=e.getBoundingClientRect();return [r.x,r.y,r.width,r.height]}));
 const before=await geometry();await p.click('[aria-label="Select Motion layout"]');await wait(350);assert.deepEqual(await geometry(),before,'Selection must not shift card titles');
 assert.equal(await p.$eval('[data-selected="true"] .calm-card-check',e=>getComputedStyle(e).opacity),'1');
 assert.equal(await p.$eval('[data-selected="false"] .calm-card-check',e=>getComputedStyle(e).opacity),'0');
 for(let run=0;run<3;run++) {
  await p.evaluate(()=>{window.routeSamples=[];window.recordRoutes=true;const tick=()=>{window.routeSamples.push([...document.querySelectorAll('[data-testid$="screen-transition"]')].map(e=>({id:e.dataset.testid,opacity:Number(getComputedStyle(e).opacity)})));if(window.recordRoutes)requestAnimationFrame(tick)};tick()});
  await p.click('[data-testid="connect-pc-button"]');await p.waitForSelector('[data-testid="connect-heading"]');await wait(400);
  await p.click('[data-testid="connect-back-button"]');await p.waitForSelector('[data-testid="home-heading"]');await wait(400);
  const samples=await p.evaluate(()=>{window.recordRoutes=false;return window.routeSamples});
  assert.ok(samples.every(s=>s.length<=1),'Only one route layer mounted during switch');
  assert.equal(await p.$eval('.calm-home-content > div',e=>getComputedStyle(e).transform),'none','Home contents must not run a second entrance');
 }
 assert.deepEqual(errors,[]);console.log('PASS stable card selection and three single-layer Connect round trips');
}finally{await browser.close()}
