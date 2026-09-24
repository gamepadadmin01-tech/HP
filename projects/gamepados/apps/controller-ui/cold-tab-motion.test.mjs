import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
const b=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try {
 const p=await b.newPage();await p.setViewport({width:412,height:915});
 await p.setRequestInterception(true);p.on('request',r=>r.url().startsWith('http://127.0.0.1:5187/')||r.url().startsWith('data:')?r.continue():r.abort());
 await p.evaluateOnNewDocument(()=>{window.AndroidBridge={onUiReady(){},getNetworkTelemetryJson:()=>'{"engineRunning":false,"linkAlive":false}',getUsbBroadcastAddress:()=>'',stopEngine(){}}});
 await p.goto('http://127.0.0.1:5187/');await p.waitForSelector('[data-testid="home-heading"]');
 const sampleTab=async(selector,reduced=false)=>{
  await p.evaluate(()=>{window.tabFrames=[];window.recordTabs=true;const tick=()=>{const e=document.querySelector('.calm-main > div > div');if(e)window.tabFrames.push(Number(getComputedStyle(e).opacity));if(window.recordTabs)requestAnimationFrame(tick)};tick()});
  await p.click(selector);await new Promise(r=>setTimeout(r,1000));
  const frames=await p.evaluate(()=>{window.recordTabs=false;return window.tabFrames});
  assert.ok(frames.length>3);assert.equal(frames.at(-1),1);
  assert.equal(frames.some(x=>x>0 && x<0.99),!reduced,`Expected ${reduced?'no':'visible'} tab animation: ${frames}`);
 };
 await sampleTab('[data-testid="nav-system-button"]');
 await sampleTab('[data-testid="nav-account-button"]');
 await sampleTab('[data-testid="nav-home-button"]');
 await p.click('[data-testid="connect-pc-button"]');await p.waitForSelector('[data-testid="connect-heading"]');await new Promise(r=>setTimeout(r,1000));
 await p.click('[data-testid="connect-back-button"]');await p.waitForSelector('[data-testid="home-heading"]');await new Promise(r=>setTimeout(r,1000));
 await sampleTab('[data-testid="nav-system-button"]');
 await p.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);await p.reload();await p.waitForSelector('[data-testid="home-heading"]');
 await sampleTab('[data-testid="nav-system-button"]',true);
 console.log('PASS cold-start tab motion before Connect, after Connect, and reduced motion');
}finally{await b.close()}
