import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
// Isolate the coordinator from browser-only persistence (covered by browser tests).
const source=fs.readFileSync(new URL('./src/app/transportCoordinator.ts',import.meta.url),'utf8').replace("import { rememberMode, cancelPendingWireless } from './store/connectionMemory';",'const rememberMode=()=>{}; const cancelPendingWireless=()=>{};');
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {createTransportCoordinator}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
function fixture(overrides={}){
 let now=100000;const calls=[];
 const s={running:true,alive:true,kind:'wireless',broadcast:'192.168.42.255',wirelessIntentAt:0,pref:'auto',...overrides};
 const c=createTransportCoordinator({now:()=>now,read:()=>({...s}),stopNative:()=>calls.push('stop'),startTether:b=>{calls.push('tether:'+b);s.running=true;s.alive=false;s.kind='wired'},connectDebug:()=>calls.push('debug'),disconnectDebug:()=>calls.push('close-debug'),restartWireless:()=>{calls.push('wifi-restart');s.sinceAck=-1}});
 return {s,c,calls,advance:ms=>{now+=ms},stopped:()=>{s.running=false;s.alive=false;s.kind='none'}};
}
let count=0;const test=(name,fn)=>{fn();count++;console.log('PASS '+name)};
test('Automatic USB discovery does not hijack active Wi-Fi',()=>{const f=fixture();f.c.reconcile();assert.deepEqual(f.calls,['close-debug'])});
for(const pref of ['tether','usbdebug','auto'])test('Explicit Wi-Fi to '+pref+' waits for native stop',()=>{
 const f=fixture({pref});f.c.chooseUsb();assert.ok(f.calls.includes('stop'));assert.ok(!f.calls.includes('debug'));assert.ok(!f.calls.some(x=>x.startsWith('tether:')));
 f.c.reconcile();assert.equal(f.calls.filter(x=>x==='stop').length,1);f.stopped();f.c.reconcile();assert.ok(f.calls.includes(pref==='usbdebug'?'debug':'tether:192.168.42.255'));
});
test('Auto USB without tether uses debugging after stopping Wi-Fi',()=>{const f=fixture({broadcast:''});f.c.chooseUsb();f.stopped();f.c.reconcile();assert.ok(f.calls.includes('debug'))});
test('Unacknowledged tether releases guard, then retries with backoff',()=>{
 const f=fixture({pref:'tether',kind:'wired',alive:false});f.c.reconcile();f.advance(11999);f.c.reconcile();assert.ok(!f.calls.includes('stop'));f.advance(1);f.c.reconcile();assert.ok(f.calls.includes('stop'));f.stopped();f.c.reconcile();assert.ok(!f.calls.some(x=>x.startsWith('tether:')));f.advance(4000);f.c.reconcile();assert.equal(f.calls.filter(x=>x.startsWith('tether:')).length,1);
});
test('Temporary ACK gap recovers without teardown',()=>{const f=fixture({pref:'tether',kind:'wired',alive:false});f.c.reconcile();f.advance(6000);f.s.alive=true;f.c.reconcile();f.advance(15000);f.c.reconcile();assert.ok(!f.calls.includes('stop'))});
test('Debugging waits for a queued tether start to be stopped',()=>{
 const f=fixture({pref:'tether',running:false,alive:false,kind:'none'});f.c.reconcile();
 // Model telemetry lag: connectToPC has queued the native start but it is not visible yet.
 f.s.running=false;f.s.pref='usbdebug';f.c.chooseUsb();assert.ok(f.calls.includes('stop'));assert.ok(!f.calls.includes('debug'));
 f.stopped();f.c.reconcile();assert.ok(f.calls.includes('debug'));
});
test('QR/manual request overrides previous explicit debugging',()=>{const f=fixture({pref:'usbdebug'});f.c.chooseUsb();f.c.chooseWireless();f.s.wirelessIntentAt=100000;f.calls.length=0;f.c.reconcile();assert.deepEqual(f.calls,['close-debug'])});
test('Slow manual Wi-Fi is not silently replaced by saved USB mode after eight seconds',()=>{const f=fixture({pref:'usbdebug',alive:false});f.c.chooseWireless();f.advance(20000);f.c.reconcile();assert.deepEqual(f.calls,['close-debug']);f.c.chooseUsb();assert.ok(f.calls.includes('stop'))});
test('Tether removal closes native before enabling debug fallback',()=>{const f=fixture({kind:'wired'});f.c.chooseUsb();f.s.broadcast='';f.c.reconcile();assert.ok(f.calls.includes('stop'));f.stopped();f.c.reconcile();assert.ok(f.calls.includes('debug'))});
test('Tether interface change restarts with the new directed broadcast',()=>{const f=fixture({running:false,alive:false,kind:'none',pref:'tether'});f.c.reconcile();f.s.broadcast='192.168.43.255';f.c.reconcile();assert.ok(f.calls.includes('stop'));f.stopped();f.c.reconcile();assert.ok(f.calls.includes('tether:192.168.43.255'))});
test('A delayed old WebSocket close cannot clear its replacement',()=>{
 const app=fs.readFileSync(new URL('./src/app/App.tsx',import.meta.url),'utf8');const worker=app.split('    const code = `')[1].split('`;')[0];const sockets=[],messages=[];
 class Socket{readyState=0;constructor(){sockets.push(this)}close(){this.readyState=3}send(){}}
 const ctx={WebSocket:Socket,postMessage:m=>messages.push(m),setTimeout:()=>1,clearTimeout(){},Date,Uint8Array,DataView,BigInt};vm.createContext(ctx);vm.runInContext(worker,ctx);
 vm.runInContext("onmessage({data:{cmd:'connect'}})",ctx);const old=sockets[0];
 vm.runInContext("onmessage({data:{cmd:'disconnect'}});onmessage({data:{cmd:'connect'}})",ctx);const current=sockets[1];current.readyState=1;current.onopen();old.onclose();assert.equal(messages.at(-1).v,true);
 vm.runInContext("onmessage({data:{cmd:'connect'}})",ctx);assert.equal(sockets.length,2);
});
// ── Wi-Fi self-heal (2026-10-05): back from recents without a rescan ──
const stalled=o=>fixture({alive:false,sinceAck:60000,canRestoreWifi:true,hidden:false,...o});
test('Back from recents: a stalled Wi-Fi link reconnects to the saved PC',()=>{const f=stalled();f.c.reconcile();assert.deepEqual(f.calls.filter(x=>x==='wifi-restart'),['wifi-restart'])});
test('Wi-Fi reconnect retries with backoff until the PC answers',()=>{const f=stalled();f.c.reconcile();f.advance(1500);f.c.reconcile();assert.equal(f.calls.filter(x=>x==='wifi-restart').length,1,'not on every tick');f.advance(6500);f.c.reconcile();assert.equal(f.calls.filter(x=>x==='wifi-restart').length,2,'retried after 8 s even though sinceAck reads -1');f.advance(8000);f.c.reconcile();assert.equal(f.calls.filter(x=>x==='wifi-restart').length,2,'second wait is 16 s');f.advance(8000);f.c.reconcile();assert.equal(f.calls.filter(x=>x==='wifi-restart').length,3)});
test('Wi-Fi reconnect stops once the PC answers, and starts fresh next time',()=>{const f=stalled();f.c.reconcile();f.s.alive=true;f.s.sinceAck=10;f.advance(20000);f.c.reconcile();assert.equal(f.calls.filter(x=>x==='wifi-restart').length,1);f.s.alive=false;f.s.sinceAck=3000;f.advance(1000);f.c.reconcile();assert.equal(f.calls.filter(x=>x==='wifi-restart').length,1,'a 3 s gap is not a stall');f.s.sinceAck=7000;f.c.reconcile();assert.equal(f.calls.filter(x=>x==='wifi-restart').length,2)});
test('No Wi-Fi reconnect while the app is in the background',()=>{const f=stalled({hidden:true});f.c.reconcile();assert.ok(!f.calls.includes('wifi-restart'))});
test('A link that never answered (VPN/firewall) is not restarted',()=>{const f=stalled({sinceAck:-1});f.advance(60000);f.c.reconcile();assert.ok(!f.calls.includes('wifi-restart'))});
test('No Wi-Fi reconnect without a saved PC',()=>{const f=stalled({canRestoreWifi:false});f.c.reconcile();assert.ok(!f.calls.includes('wifi-restart'))});
test('A short Wi-Fi blip is left alone',()=>{const f=stalled({sinceAck:4000});f.c.reconcile();assert.ok(!f.calls.includes('wifi-restart'))});
test('USB sessions are never touched by the Wi-Fi reconnect',()=>{const f=stalled({kind:'wired',pref:'tether'});f.c.reconcile();assert.ok(!f.calls.includes('wifi-restart'))});
// ── Wi-Fi → USB (2026-10-13): plug the cable in while on Wi-Fi and the session moves to it ──
const wifiThenCable=o=>{const f=fixture({broadcast:'',canRestoreWifi:true,hidden:false,...o});f.c.reconcile();f.s.broadcast='192.168.42.255';f.advance(500);return f};
const switched=o=>{const f=wifiThenCable(o);f.c.reconcile();f.stopped();f.c.reconcile();return f};
test('Cable plugged in while on Wi-Fi: moves to USB after the Wi-Fi engine has stopped',()=>{const f=wifiThenCable();f.c.reconcile();assert.ok(f.calls.includes('stop'));assert.ok(!f.calls.some(x=>x.startsWith('tether:')),'waits for the native stop');f.stopped();f.c.reconcile();assert.ok(f.calls.includes('tether:192.168.42.255'))});
test('A Wi-Fi choice made before the cable does not block the move',()=>{const f=fixture({broadcast:'',canRestoreWifi:true});f.c.chooseWireless();f.advance(2000);f.c.reconcile();f.s.broadcast='192.168.42.255';f.advance(500);f.c.reconcile();assert.ok(f.calls.includes('stop'))});
test('A Wi-Fi choice made after the cable keeps Wi-Fi',()=>{const f=fixture({broadcast:'',canRestoreWifi:true,hidden:true});f.c.reconcile();f.s.broadcast='192.168.42.255';f.advance(500);f.c.reconcile();f.s.hidden=false;f.c.chooseWireless();f.advance(500);f.c.reconcile();assert.ok(!f.calls.includes('stop'))});
test('A cable that was already plugged in when the app started does not take over Wi-Fi',()=>{const f=fixture({canRestoreWifi:true});f.c.reconcile();f.advance(5000);f.c.reconcile();assert.ok(!f.calls.includes('stop'))});
test('No move without a saved Wi-Fi PC to fall back to',()=>{const f=wifiThenCable({canRestoreWifi:false});f.c.reconcile();assert.ok(!f.calls.includes('stop'))});
test('No move while the app is in the background',()=>{const f=wifiThenCable({hidden:true});f.c.reconcile();assert.ok(!f.calls.includes('stop'))});
test('USB that never answers goes back to the saved Wi-Fi PC, and is not retried on this plug-in',()=>{
 const f=switched();f.advance(9999);f.c.reconcile();assert.ok(!f.calls.includes('wifi-restart'));f.advance(2);f.c.reconcile();assert.deepEqual(f.calls.filter(x=>x==='wifi-restart'),['wifi-restart']);
 f.s.running=true;f.s.alive=true;f.s.kind='wireless';f.calls.length=0;for(let i=0;i<20;i++){f.advance(1500);f.c.reconcile()}
 assert.ok(!f.calls.includes('stop'));assert.ok(!f.calls.some(x=>x.startsWith('tether:')));
});
test('USB that works, then is unplugged: back to Wi-Fi',()=>{const f=switched();f.s.alive=true;f.advance(1500);f.c.reconcile();assert.ok(!f.calls.includes('wifi-restart'));f.s.broadcast='';f.advance(1500);f.c.reconcile();assert.deepEqual(f.calls.filter(x=>x==='wifi-restart'),['wifi-restart'])});
test('Unplug and plug in again moves to USB again',()=>{
 const f=switched();f.advance(10001);f.c.reconcile();f.s.running=true;f.s.alive=true;f.s.kind='wireless';f.s.broadcast='';f.advance(1500);f.c.reconcile();
 f.s.broadcast='192.168.42.255';f.advance(1500);f.calls.length=0;f.c.reconcile();assert.ok(f.calls.includes('stop'));
});
test('Choosing USB yourself after the move is not turned back into Wi-Fi',()=>{const f=switched();f.s.alive=true;f.c.chooseUsb();f.s.broadcast='';f.advance(1500);f.c.reconcile();assert.ok(!f.calls.includes('wifi-restart'))});
test('USB-debugging users keep their own rules: no automatic move',()=>{const f=wifiThenCable({pref:'usbdebug'});f.c.reconcile();assert.ok(!f.calls.includes('tether:192.168.42.255'))});
console.log(`${count} transport regression cases passed`);
