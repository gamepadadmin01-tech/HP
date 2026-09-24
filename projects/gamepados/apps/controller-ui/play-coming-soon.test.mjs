import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
const b=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try {
 for(const channel of ['playstore','uptodown','direct']) {
  const p=await b.newPage();await p.setViewport({width:412,height:915});
  await p.setRequestInterception(true);p.on('request',r=>r.url().startsWith('http://127.0.0.1:5187/')||r.url().startsWith('data:')?r.continue():r.abort());
  await p.evaluateOnNewDocument(channel=>{window.purchaseCalls=0;window.AndroidBridge={getDistributionChannel:()=>channel,getNetworkTelemetryJson:()=>'{"engineRunning":false,"linkAlive":false}',getUsbBroadcastAddress:()=>'',startPlayPurchase:()=>window.purchaseCalls++};},channel);
  await p.goto('http://127.0.0.1:5187/');await p.waitForSelector('[data-testid="nav-account-button"]');await p.click('[data-testid="nav-account-button"]');await new Promise(r=>setTimeout(r,500));
  assert.equal(!!await p.$('[data-testid="play-billing-notice"]'),channel==='playstore');
  if(channel==='playstore') {
   assert.ok((await p.$eval('.guest-plans',e=>e.textContent)).includes('30 minutes, every day'));
   assert.equal(await p.$('[data-testid^="choose-"]'),null);
   const result=await p.evaluate(async()=>{const {purchase}=await import('/src/app/store/purchase.ts');return purchase({code:'LIFETIME',purchasable:true,playProductId:'test'});});
   assert.equal(result.ok,false);assert.ok(result.message.includes('available soon'));assert.equal(await p.evaluate(()=>window.purchaseCalls),0);
  }
  await p.close();
 }
 console.log('PASS Play guest quota/notice, purchase blocked, Uptodown/direct unaffected');
}finally{await b.close()}
