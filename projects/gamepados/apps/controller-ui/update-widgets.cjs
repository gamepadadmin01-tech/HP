const fs = require('fs');
const path = 'F:\\hlooo\\controller-ui\\src\\app\\components\\GamepadWidgets.tsx';
let str = fs.readFileSync(path, 'utf8');

if (!str.includes('StickModeSelectorBlock')) {
  str += `

// ─── Stick Mode Selector Block ──────────────────────────────────────────────
export function StickModeSelectorBlock({ x, y, size, mode, active, onSelect }: {
  x: number; y: number; size: number; mode: "L" | "R"; active: boolean; onSelect: (m: "L" | "R") => void;
}) {
  const r = size * 0.38;
  const cx = x + size / 2;
  const cy = y + size / 2;
  return (
    <g>
      <WidgetBase x={x} y={y} w={size} h={size} />
      <g style={{ cursor: "pointer", touchAction: "none" }}
        onPointerDown={e => { try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch(_){} onSelect(mode); }}>
        {active && (
          <circle cx={cx} cy={cy} r={r + 14} fill="rgba(0,212,255,0.35)" style={{ pointerEvents: "none", filter: "blur(10px)" }} />
        )}
        <circle cx={cx} cy={cy} r={r} fill={active ? RED_HELD : RED_NORM}
          stroke={active ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.07)"} strokeWidth={active ? 2.5 : 1.5} />
        <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central"
          fontSize={r * 0.4} fontWeight="800" fill={active ? "#000" : "rgba(255,255,255,0.88)"}
          style={{ fontFamily: "'Inter',sans-serif", pointerEvents: "none", userSelect: "none" }}>
          {mode === "L" ? "L-Mod" : "R-Mod"}
        </text>
      </g>
    </g>
  );
}
`;
  fs.writeFileSync(path, str, 'utf8');
  console.log('Added StickModeSelectorBlock');
}
