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
 const c=createTransportCoordinator({now:()=>now,read:()=>({...s}),stopNative:()=>calls.push('stop'),startTether:b=>{calls.push('tether:'+b);s.running=true;s.alive=false;s.kind='wired'},connectDebug:()=>calls.push('debug'),disconnectDebug:()=>calls.push('close-debug')});
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
console.log(`${count} transport regression cases passed`);
