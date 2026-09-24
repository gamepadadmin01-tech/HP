// Focused browser checks, not a screen-reader certification or hardware test.
import fs from 'node:fs';
import http from 'node:http';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
const html=fs.readFileSync(new URL('./dist/index.html',import.meta.url));
const server=http.createServer((q,r)=>{r.setHeader('Content-Type','text/html');r.end(html)});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
let browser;
const evidence=[];
try {
  browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  const p=await browser.newPage();
  await p.setRequestInterception(true);p.on('request',r=>r.url().startsWith(origin+'/')?r.continue():r.abort());
  await p.evaluateOnNewDocument(()=>localStorage.setItem('feature_rated_v2','1'));
  const settle=()=>new Promise(r=>setTimeout(r,400));
  const inspect=async name=>{
    const data=await p.evaluate(()=>{
      const rgb=s=>(s.match(/[\d.]+/g)||[]).map(Number);
      const luminance=c=>c.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
      const contrast=(a,b)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)};
      const textChecks=[...document.querySelectorAll('.calm-intro h1,.calm-intro p,.calm-connection strong,.calm-connection small,.calm-card-name,.calm-card-detail,.calm-primary,.calm-step h2,.calm-step p')].map(el=>{
        const css=getComputedStyle(el);let bg,ancestor=el;
        while(ancestor){bg=rgb(getComputedStyle(ancestor).backgroundColor);if(bg.length===3||bg[3]===1)break;ancestor=ancestor.parentElement;}
        return {text:el.textContent.slice(0,55),ratio:contrast(rgb(css.color),bg),fontSize:parseFloat(css.fontSize),weight:parseInt(css.fontWeight)};
      });
      const controls=[...document.querySelectorAll('.gp-shell button,.gp-shell input')].filter(e=>e.getClientRects().length).map(el=>{
        const r=el.getBoundingClientRect();return {name:el.getAttribute('aria-label')||el.textContent.trim().slice(0,60)||el.id,width:r.width,height:r.height};
      });
      return {textChecks,controls,overflow:document.documentElement.scrollWidth>innerWidth+1};
    });
    assert.equal(data.overflow,false,name+' overflow');
    for(const t of data.textChecks)assert.ok(t.ratio>=(t.fontSize>=24||(t.fontSize>=18.66&&t.weight>=700)?3:4.5),`${name}: ${t.text} contrast ${t.ratio}`);
    for(const c of data.controls)assert.ok(c.name,`${name}: unnamed control`);
    evidence.push({name,...data});
  };
  await p.setViewport({width:412,height:915});await p.goto(origin);await settle();
  await inspect('Home dark');await p.click('[aria-label="Use light appearance"]');await settle();await inspect('Home light');
  await p.keyboard.press('Tab');
  const focus=await p.evaluate(()=>{const e=document.activeElement,s=getComputedStyle(e);return {tag:e.tagName,width:s.outlineWidth,style:s.outlineStyle}});
  assert.notEqual(focus.style,'none');evidence.push({keyboardFocus:focus});
  await p.click('.calm-connection');await settle();await inspect('Connect light');
  await p.click('[aria-label="Use dark appearance"]');await settle();await inspect('Connect dark');
  await p.click('.calm-manual-toggle');await settle();
  await p.setViewport({width:320,height:420});await settle();await inspect('Manual entry with small available viewport');
  await p.click('.calm-manual button[type="submit"]');
  assert.ok(await p.$('[role="alert"]'));
  evidence.push({invalidManualInput:'Alert visible without a native connection attempt'});
  const out=new URL('../../docs/ui-redesign-research-2026-09-16/implementation/accessibility-check.json',import.meta.url);
  fs.writeFileSync(out,JSON.stringify({testedAt:new Date().toISOString(),evidence,screenReaderTested:false,hardwareTested:false},null,2));
  console.log('PASS sampled text contrast, named controls, keyboard focus, narrow/short manual form and validation');
  console.log(JSON.stringify(evidence.flatMap(e=>(e.controls||[]).filter(c=>c.width<44||c.height<44).map(c=>({screen:e.name,...c}))),null,2));
} finally {if(browser)await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
