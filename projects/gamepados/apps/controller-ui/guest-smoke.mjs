import http from 'node:http';
import fs from 'node:fs';
import puppeteer from 'puppeteer';
const html=fs.readFileSync('dist/index.html');
const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(html)}).listen(5199,'127.0.0.1');
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try {
 const p=await browser.newPage(); await p.setViewport({width:412,height:915,deviceScaleFactor:1});
 const errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.setRequestInterception(true);p.on('request',r=>{if(r.url().startsWith('http://127.0.0.1:5199'))return r.continue();if(r.url().includes('/api/billing/plans'))return r.respond({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify({success:true,channel:'direct',currency:'INR',purchasable:true,plans:[{code:'THREE_DAY',displayName:'3 Days',currency:'INR',priceMinor:4900,unlimited:true,dailySeconds:null,durationHours:72,durationMonths:null,purchasable:true,priceFromStore:false}]})});return r.abort();});
 await p.goto('http://127.0.0.1:5199'); await new Promise(r=>setTimeout(r,1500));
 await p.setViewport({width:915,height:412,deviceScaleFactor:1});
 await p.evaluate(()=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Open controller')?.click());
 await p.waitForSelector('.guest-trial-pill',{timeout:5000});
 await new Promise(r=>setTimeout(r,1500));
 await p.screenshot({path:'D:/AKHIL/HP/context/recovery/guest-trial-2026-09-11/guest-controller-preview.png'});
 await p.setViewport({width:412,height:915,deviceScaleFactor:1});
 await p.reload();await new Promise(r=>setTimeout(r,1000));
 if(await p.evaluate(()=>document.body.innerText.includes('Pick a controller and play')))throw Error('Introduction reappeared after first launch');
 await p.evaluate(()=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Account')?.click());await new Promise(r=>setTimeout(r,700));
 await p.screenshot({path:'D:/AKHIL/HP/context/recovery/guest-trial-2026-09-11/guest-plans-preview.png'});
 if(await p.$('input[type=password]'))throw Error('Sign-in shown before purchase');
 await p.evaluate(()=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Get 3 Days'))?.click());await new Promise(r=>setTimeout(r,300));
 if(!await p.$('input[type=password]'))throw Error('Purchase did not open sign-in');
 if(errors.length)throw Error(errors.join('\n')); console.log('PASS guest plans then sign-in only after choosing purchase');
 await p.evaluate(()=>{localStorage.setItem('gp_guest_trial_preview',JSON.stringify({used:1798,resetsAt:Date.now()+3600000}));});
 await p.reload();await new Promise(r=>setTimeout(r,1000));
 await p.evaluate(()=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Open controller')?.click());
 await p.waitForSelector('.guest-trial-pill',{timeout:5000});
 if(await p.$('input[type=password]'))throw Error('Controller required sign-in');
 await p.waitForFunction(()=>document.body.innerText.includes("Today's free time is used"),{timeout:6000});
 const used=await p.evaluate(()=>JSON.parse(localStorage.getItem('gp_guest_trial_preview')).used);
 if(used!==1800)throw Error('Expiry was not saved');
 console.log('PASS guest controller opens, expires, saves usage and returns to plans');
}finally{
 server.closeAllConnections();server.close();
 let shutdownTimer;
 try { await Promise.race([browser.close(),new Promise(resolve=>{
  shutdownTimer=setTimeout(()=>{browser.process()?.kill();browser.disconnect();resolve();},10000);
 })]); } finally { clearTimeout(shutdownTimer); }
}
