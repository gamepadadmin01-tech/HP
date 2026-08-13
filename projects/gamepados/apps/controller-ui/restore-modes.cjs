const fs = require('fs');

const path = 'F:\\hlooo\\controller-ui\\src\\app\\App.tsx';
let str = fs.readFileSync(path, 'utf8');

// Ensure StickModeSelectorBlock is imported
if (!str.includes('StickModeSelectorBlock')) {
  str = str.replace(
    'SingleButtonBlock } from "./components/GamepadWidgets";',
    'SingleButtonBlock, StickModeSelectorBlock } from "./components/GamepadWidgets";'
  );
}

// Re-write the render loop mapping
const targetStart = '{activePad.buttons.map((btn: CustomBtnDef) => {';
const targetEnd = 'return null;\n            })}';

const startIdx = str.indexOf(targetStart);
const endIdx = str.indexOf(targetEnd, startIdx) + targetEnd.length;

if (startIdx !== -1 && endIdx !== -1) {
  const replacement = `{activePad.buttons.map((btn: CustomBtnDef) => {
              const size = btn.r;
              const w = btn.w ?? size;
              const h = btn.h ?? size;

              const triggerH = (hpt: number) => {
                 if (hpt > 0) triggerHaptic(Math.round(hpt / 2));
              };
              
              if (btn.type === "face_cluster") {
                return <FaceButtonCluster key={btn.uid} x={btn.x} y={btn.y} size={size} held={heldCustom} dn={(id) => { dnCustom(id); triggerH(btn.haptic); }} up={upCustom} />;
              }
              if (btn.type === "dpad_grid") {
                return <DpadBlock key={btn.uid} x={btn.x} y={btn.y} size={size} held={heldCustom} dn={(id) => { dnCustom(id); triggerH(btn.haptic); }} up={upCustom} />;
              }
              if (btn.type === "stick_block") {
                const isDynamic = btn.label === "STICK";
                const isLeft = btn.label === "L";
                const activeStick = isDynamic ? (stickMode === "L" ? lstick : rstick) : (isLeft ? lstick : rstick);
                const activeId = isDynamic ? (stickMode === "L" ? "lstick" : "rstick") : (isLeft ? "lstick" : "rstick");
                const labelStr = isDynamic ? "Dynamic Stick" : (isLeft ? "Left stick" : "Right stick");

                return <StickBlock key={btn.uid} x={btn.x} y={btn.y} size={size} stick={activeStick} id={activeId as any} held={heldCustom} dn={(id) => { dnCustom(id); triggerH(btn.haptic); }} up={upCustom} label={labelStr} />;
              }
              if (btn.type === "trigger_block") {
                const isLeft = btn.label === "LT";
                return <TriggerBlock key={btn.uid} x={btn.x} y={btn.y} w={w} h={h} label={btn.label} id={btn.label as any} held={heldCustom} dn={(id) => { dnCustom(id); triggerH(btn.haptic); }} up={upCustom} fill={isLeft ? ltFill : rtFill} onFillChange={isLeft ? setLtFill : setRtFill} svgRef={svgRef} />;
              }
              if (btn.type === "single_block") {
                if (btn.label === "L-Mod" || btn.label === "R-Mod") {
                   const mode = btn.label === "L-Mod" ? "L" : "R";
                   return <StickModeSelectorBlock key={btn.uid} x={btn.x} y={btn.y} size={size} mode={mode} active={stickMode === mode} onSelect={(m) => { selectStickMode(m); triggerH(btn.haptic); }} />;
                }
                return <SingleButtonBlock key={btn.uid} x={btn.x} y={btn.y} size={size} label={btn.label} id={btn.label as any} held={heldCustom} dn={(id) => { dnCustom(id); triggerH(btn.haptic); }} up={upCustom} />;
              }
              
              return null;
            })}`;
            
  str = str.substring(0, startIdx) + replacement + str.substring(endIdx);
}

fs.writeFileSync(path, str, 'utf8');
console.log('Restored Stick Modes & Dynamic Stick mapping to App.tsx');
