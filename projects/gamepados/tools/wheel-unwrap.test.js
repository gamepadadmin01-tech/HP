// Wheel mode (900°/720°) — multi-turn steering unwrap, unit tests.
//
// This mirrors MainActivity.unwrapRoll exactly. It lives here because the unwrap is
// the one part of wheel mode where a mistake is DANGEROUS rather than merely wrong:
// it fails as a violent full-lock jerk mid-corner, not as a visible error. The Kotlin
// original has no test harness around it, so the algorithm is pinned here instead.
//
// If you change unwrapRoll in MainActivity.kt, change it here too and re-run:
//     node tools/wheel-unwrap.test.js
//
// Test 5 exists because of a real bug caught during development: an earlier draft
// capped the turn count at 3 turns "for safety", which silently reintroduced the same
// 360-degree discontinuity the function exists to remove, and left the wheel centre a
// full turn out after over-rotating and returning. Do not add a cap back.

// Port of MainActivity.unwrapRoll — same algorithm, exercised over real rotations.
// The unwrapper tracks CONTINUOUS MOTION from wherever it was seeded; it cannot know
// the absolute angle you started at, and does not need to (calibrate defines centre).
function makeUnwrapper(){
  let prev=0, turns=0, init=false;
  return {
    feed(raw){
      if(!init){ prev=raw; init=true; return raw; }
      const d=raw-prev;
      if(d>180) turns-=1; else if(d<-180) turns+=1;
      prev=raw;
      return raw+turns*360;
    },
    reset(){ turns=0; init=false; }
  };
}
const wrap=a=>{ let x=((a+180)%360+360)%360-180; return x===-180?180:x; };
let fails=0;
const check=(n,c,e='')=>{ if(!c){fails++;console.log('FAIL '+n+(e?'  '+e:''));} else console.log('PASS '+n); };

// 1. Continuity + relative accuracy across the whole ±900° travel.
{
  const u=makeUnwrapper();
  let maxJump=0,maxErr=0,prevOut=null,base=null;
  for(let t=-900;t<=900;t++){
    const out=u.feed(wrap(t));
    if(base===null){ base=out-t; prevOut=out; continue; }
    maxJump=Math.max(maxJump,Math.abs(out-prevOut));
    maxErr=Math.max(maxErr,Math.abs((out-base)-t));
    prevOut=out;
  }
  check('continuous over a ±900° sweep (no jump > 1°)',maxJump<=1.0001,'maxJump='+maxJump);
  check('relative travel exact over ±900°',maxErr<1e-9,'maxErr='+maxErr);
}
// 2. The documented failure: crossing +180 must not flip to full opposite lock.
{
  const u=makeUnwrapper(); u.feed(179);
  const out=u.feed(wrap(181));
  check('crossing +180 continues to 181 (no full-lock flip)',Math.abs(out-181)<1e-9,'got '+out);
}
// 3. 900° wheel reaches exactly full lock at 450°.
{
  const u=makeUnwrapper(),sens=450; let out=0;
  for(let t=0;t<=450;t++) out=u.feed(wrap(t));
  check('900° range: full lock exactly at 450°',Math.abs(Math.max(-1,Math.min(1,out/sens))-1)<1e-9);
}
// 4. 720° wheel: full lock after one whole revolution, where raw atan2 reads 0.
{
  const u=makeUnwrapper(); let out=0;
  for(let t=0;t<=360;t++) out=u.feed(wrap(t));
  check('720° range: full lock after one revolution',Math.abs(out-360)<1e-9,'out='+out);
  check('  (raw atan2 reads 0° there — this is what unwrapping fixes)',Math.abs(wrap(360))<1e-9);
}
// 5. No cap: many turns out AND back must return to the exact starting angle.
//    This is what the removed ±3-turn clamp used to break.
{
  const u=makeUnwrapper(); let out=0;
  for(let t=0;t<=3600;t++) out=u.feed(wrap(t));        // ten turns right
  check('ten turns out tracks exactly (uncapped)',Math.abs(out-3600)<1e-9,'out='+out);
  for(let t=3599;t>=0;t--) out=u.feed(wrap(t));        // and back
  check('ten turns back returns to exact centre',Math.abs(out)<1e-9,'out='+out);
}
// 6. Symmetric to the left.
{
  const u=makeUnwrapper(); let out=0;
  for(let t=0;t>=-450;t--) out=u.feed(wrap(t));
  check('symmetric left (-450° = full left lock)',Math.abs(out+450)<1e-9,'out='+out);
}
// 7. reset() drops banked turns so a recentre cannot inherit whole revolutions.
{
  const u=makeUnwrapper();
  for(let t=0;t<=720;t++) u.feed(wrap(t));
  u.reset();
  check('reset() clears banked turns',Math.abs(u.feed(wrap(720)))<1e-9);
}
// 8. Direct tilt mode is untouched inside its own range.
{
  const u=makeUnwrapper(); let bad=0,base=null;
  for(let t=-30;t<=30;t++){ const o=u.feed(wrap(t)); if(base===null)base=o-t; else if(Math.abs((o-base)-t)>1e-9)bad++; }
  check('direct tilt (±30°) behaves exactly as before',bad===0,'mismatches='+bad);
}
// 9. Realistic fast steering: 720°/second sampled at 200 Hz cannot alias.
{
  const u=makeUnwrapper(); let t=0,out=0,maxJump=0,prev=null;
  for(let i=0;i<200;i++){ t+=720/200; const o=u.feed(wrap(t)); if(prev!==null)maxJump=Math.max(maxJump,Math.abs(o-prev)); prev=o; out=o; }
  check('two turns/sec at 200 Hz stays continuous',maxJump<10 && Math.abs(out-720)<1e-9,'maxJump='+maxJump+' out='+out);
}
console.log(fails? '\n'+fails+' FAILURES' : '\nall '+9+' unwrap groups pass');
process.exit(fails?1:0);
