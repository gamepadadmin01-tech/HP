// Minimal CDP evaluator for the GamepadOS WebView (node >=22, global WebSocket).
// Usage: node cdp.mjs "<js expression>"   (expression is awaited if it returns a promise)
const expr = process.argv[2];
if (!expr) { console.error("usage: node cdp.mjs <expr>"); process.exit(1); }

const targets = await (await fetch("http://127.0.0.1:9223/json")).json();
const page = targets.find(t => t.type === "page");
if (!page) { console.error("no page target"); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let id = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}) => new Promise((res) => {
  const mid = ++id;
  pending.set(mid, res);
  ws.send(JSON.stringify({ id: mid, method, params }));
});

const r = await send("Runtime.evaluate", {
  expression: expr,
  returnByValue: true,
  awaitPromise: true,
});
if (r.result?.exceptionDetails) {
  console.error("EXC:", JSON.stringify(r.result.exceptionDetails, null, 2));
} else {
  const v = r.result?.result;
  console.log(typeof v?.value === "string" ? v.value : JSON.stringify(v?.value, null, 1));
}
ws.close();
process.exit(0);
