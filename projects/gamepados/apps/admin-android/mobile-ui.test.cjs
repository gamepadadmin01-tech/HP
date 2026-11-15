const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');
const code=fs.readFileSync(__dirname+'/app/src/main/assets/mobile.js','utf8');
function fixture(approval='signed-header'){
  let called,formOptions,promptMessage;const location={href:'https://supportportal.gamepad.space/admin',origin:'https://supportportal.gamepad.space'};
  const window={uiForm:async o=>{formOptions=o;return {version:'1.0'};},fetch:async(...args)=>{called=args;return {ok:true};},prompt:m=>{promptMessage=m;return approval;}};
  vm.runInNewContext(code,{window,location,URL,Headers,document:{createElement:()=>({}),head:{appendChild:()=>{}}}});
  return {window,get called(){return called;},get formOptions(){return formOptions;},get promptMessage(){return promptMessage;}};
}
test('mobile release forms replace release key with biometric explanation',async()=>{const f=fixture();await f.window.uiForm({fields:[{name:'version'},{name:'releaseKey'}]});assert.equal(f.formOptions.fields.length,1);assert.match(f.formOptions.intro,/fingerprint/);});
test('release requests carry native approval of exact body',async()=>{const f=fixture();const body=JSON.stringify({version:'1.4',notes:'Unicode: 🎮'});await f.window.fetch('/api/admin/releases/register-activate',{method:'POST',body});assert.equal(f.called[1].headers.get('x-mobile-approval'),'signed-header');assert.equal(JSON.parse(f.promptMessage.slice(13)).body,body);});
test('cancelled biometrics never sends release request',async()=>{const f=fixture(null);await assert.rejects(f.window.fetch('/api/admin/releases/abc/activate',{method:'POST',body:'{}'}),/cancelled/);assert.equal(f.called,undefined);});
test('ordinary requests and external endpoints do not receive mobile approvals',async()=>{const f=fixture();await f.window.fetch('/api/admin/tickets',{method:'POST',body:'{}'});assert.equal(f.promptMessage,undefined);await f.window.fetch('https://external.test/api/admin/releases/abc/activate',{method:'POST',body:'{}'});assert.equal(f.promptMessage,undefined);});
test('scheduled releases require biometric approval',async()=>{const f=fixture();await f.window.fetch('/api/admin/releases/schedule',{method:'POST',body:'{"at":"2027-01-01"}'});assert.match(f.promptMessage,/schedule/);});
test('query-string release URLs are rejected',async()=>{const f=fixture();await assert.rejects(f.window.fetch('/api/admin/releases/abc/activate?x=1',{method:'POST',body:'{}'}),/query/);assert.equal(f.called,undefined);});
