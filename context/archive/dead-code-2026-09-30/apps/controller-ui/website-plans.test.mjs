import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const b=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const code='c'.repeat(64), browserToken='b'.repeat(64);
try {
 for(const signed of [false,true,'unavailable']) {
  console.log('app case',signed);
  const p=await b.newPage();await p.setViewport({width:412,height:915});
  await p.setRequestInterception(true);p.on('request',r=>{
   if(r.url().endsWith('/api/account/website-login'))return r.respond({status:signed==='unavailable'?503:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Allow-Methods':'POST'},body:JSON.stringify({success:true,code})});
   if(r.url().startsWith('http://127.0.0.1:5187/')||r.url().startsWith('data:'))return r.continue();return r.abort();
  });
  await p.evaluateOnNewDocument(signed=>{if(signed)localStorage.setItem('gp_account',JSON.stringify({token:'app-session-fixture',user:{id:'u',email:'test@example.com',displayName:'Test'}}));window.opened=[];window.AndroidBridge={getDistributionChannel:()=>'playstore',openUrl:u=>window.opened.push(u),getNetworkTelemetryJson:()=>'{"engineRunning":false,"linkAlive":false}',getUsbBroadcastAddress:()=>''};},signed);
  await p.goto('http://127.0.0.1:5187/');await p.waitForSelector('[data-testid="nav-account-button"]');await p.click('[data-testid="nav-account-button"]');await p.waitForSelector('[data-testid="website-plans-button"]');
  await p.click('[data-testid="website-plans-button"]');if(signed==='unavailable'){await p.waitForFunction(()=>document.body.innerText.includes('Automatic sign-in is unavailable'));assert.equal(await p.evaluate(()=>window.opened.length),0);await p.evaluate(()=>[...document.querySelectorAll('button')].find(e=>e.textContent==='Continue to website').click());assert.equal(await p.evaluate(()=>window.opened[0]),'https://www.gamepad.space/account');await p.close();continue;}await p.waitForFunction(()=>window.opened.length===1,{timeout:5000}).catch(async e=>{console.log(await p.evaluate(()=>({opened:window.opened,text:document.body.innerText,session:localStorage.getItem('gp_account')})));throw e;});
  assert.equal(await p.evaluate(()=>window.opened[0]),'https://www.gamepad.space/account'+(signed?'#app_login='+code:''));await p.close();
 }
 for(const mode of ['guest','handoff','expired']) {
  const p=await b.newPage();const authHeaders=[];
  await p.setRequestInterception(true);p.on('request',async r=>{
   const url=new URL(r.url());
   if(url.pathname.startsWith('/api/')) {
    if(r.method()==='OPTIONS')return r.respond({status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Allow-Methods':'GET, POST'}});
    authHeaders.push(r.headers().authorization||'');
    let body={};let status=200;
    if(url.pathname.endsWith('/exchange')) {body={token:browserToken};if(mode==='expired'){status=401;body={error:'Expired'};}}
    else if(url.pathname.endsWith('/me'))body=url.pathname.includes('billing')?{plan:'FREE',today:{limitSeconds:3600,remainingSeconds:3600}}:{user:{email:'app-user@example.com',displayName:'App user'}};
    else if(url.pathname.endsWith('/plans'))body={purchasable:true,plans:[]};
    return r.respond({status,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify(body)});
   }
   if(url.origin==='https://www.gamepad.space') {
    const rel=url.pathname==='/account'?'account.html':url.pathname.slice(1);
    try {let body=await fs.readFile('D:/AKHIL/HP/projects/gamepados/website/frontend/'+rel);if(rel==='js/config.js')body=body.toString().replace('import.meta.env.VITE_API_BASE',"''");return r.respond({status:200,contentType:rel.endsWith('.js')?'text/javascript':rel.endsWith('.css')?'text/css':'text/html',body});}catch{}
   }
   return r.abort();
  });
  if(mode!=='guest')await p.evaluateOnNewDocument(()=>localStorage.setItem('gpos_token','different-browser-account'));
  await p.goto('https://www.gamepad.space/account'+(mode==='guest'?'':'#app_login='+code));
  if(mode==='handoff'){await p.waitForFunction(()=>!document.getElementById('state-account').hidden);assert.equal(await p.$eval('#acc-email',e=>e.textContent),'app-user@example.com');assert.equal(await p.evaluate(()=>localStorage.getItem('gpos_token')),browserToken);}
  else {await p.waitForFunction(()=>!document.getElementById('state-auth').hidden);assert.equal(await p.evaluate(()=>localStorage.getItem('gpos_token')),null);}
  assert.equal(new URL(p.url()).hash,'');assert.ok(!authHeaders.includes('Bearer different-browser-account'));await p.close();
 }
 console.log('PASS app guest/signed website redirect; website guest/same-account handoff/expired link; history scrub and no wrong-account checkout');
}finally{await b.close()}
