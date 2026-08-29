// Faithful port of MainActivity.OneEuroFilter, before vs after the range-normalisation
// fix. Purpose: verify the claim that wheel mode degenerated into a pass-through.
const REF_LOCK = 45.0;

function makeFilter({ minCutoff = 2.8, beta = 0.5, dCutoff = 3.5, fullLock = REF_LOCK, scaled }) {
  let xPrev = 0, dxPrev = 0, started = false;
  const alpha = (cutoff, dt) => 1 / (1 + (1 / (2 * Math.PI * cutoff)) / dt);
  const stats = { cutoffs: [], alphas: [] };
  return {
    stats,
    filter(x, dt) {
      if (!started) { started = true; xPrev = x; dxPrev = 0; return x; }
      const dx = (x - xPrev) / dt;
      const aD = alpha(dCutoff, dt);
      const edx = aD * dx + (1 - aD) * dxPrev;
      dxPrev = edx;
      // THE FIX: scale the speed term by the axis range.
      const k = scaled ? (REF_LOCK / fullLock) : 1.0;
      const cutoff = minCutoff + beta * k * Math.abs(edx);
      const aX = alpha(cutoff, dt);
      stats.cutoffs.push(cutoff);
      stats.alphas.push(aX);
      const xFilt = aX * x + (1 - aX) * xPrev;
      xPrev = xFilt;
      return xFilt;
    },
  };
}

// Realistic input: sweep to full lock, quantised to the 8-bit axis step, plus sensor noise.
function sweep(fullLock, seconds, hz, seed) {
  const n = Math.round(seconds * hz), dt = 1 / hz;
  const step = (2 * fullLock) / 255;           // one axis LSB in degrees
  let s = seed, out = [];
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5;
  for (let i = 0; i < n; i++) {
    const ideal = fullLock * Math.sin((Math.PI / 2) * (i / n)); // smooth sweep to lock
    const noisy = ideal + rnd() * step * 0.6;                   // gyro noise ~ sub-LSB
    out.push({ t: i * dt, x: Math.round(noisy / step) * step, ideal, dt, step });
  }
  return out;
}

function roughness(vals, step) {
  // RMS of the second difference = how much step-jitter survives, in LSBs.
  let acc = 0, n = 0;
  for (let i = 2; i < vals.length; i++) {
    const d2 = vals[i] - 2 * vals[i - 1] + vals[i - 2];
    acc += d2 * d2; n++;
  }
  return Math.sqrt(acc / n) / step;
}

function run(label, fullLock, scaled) {
  const sig = sweep(fullLock, 1.5, 200, 42);
  const f = makeFilter({ fullLock, scaled });
  const out = sig.map((s) => f.filter(s.x, s.dt));
  const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  return {
    label,
    medCutoff: med(f.stats.cutoffs),
    maxCutoff: Math.max(...f.stats.cutoffs),
    medAlpha: med(f.stats.alphas),
    roughLSB: roughness(out, sig[0].step),
    lagDeg: Math.max(...sig.map((s, i) => Math.abs(s.ideal - out[i]))),
  };
}

const rows = [
  run("normal +/-45  BEFORE", 45, false),
  run("normal +/-45  AFTER ", 45, true),
  run("wheel 900     BEFORE", 450, false),
  run("wheel 900     AFTER ", 450, true),
];

console.log("mode                 medCutoff   maxCutoff   medAlpha   roughness(LSB)  peakLag(deg)");
for (const r of rows) {
  console.log(
    r.label.padEnd(21) +
      r.medCutoff.toFixed(1).padStart(9) +
      r.maxCutoff.toFixed(0).padStart(12) +
      r.medAlpha.toFixed(4).padStart(11) +
      r.roughLSB.toFixed(3).padStart(16) +
      r.lagDeg.toFixed(2).padStart(14)
  );
}
console.log("\nalpha == 1.0 means the filter is a pass-through (output = raw input).");
console.log("roughness is RMS second-difference in axis LSBs: higher = notchier.");
