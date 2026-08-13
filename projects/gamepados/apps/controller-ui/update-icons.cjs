const fs = require('fs');

const path = 'F:\\hlooo\\controller-ui\\src\\app\\components\\GamepadWidgets.tsx';
let str = fs.readFileSync(path, 'utf8');

const target = `export function SingleButtonBlock({ x, y, size, label, id, held, dn, up, fontSize, normColor = RED_NORM, heldColor = RED_HELD }: {
  x: number; y: number; size: number; label: React.ReactNode;
  id: string; held: Set<any>; dn: (id: any) => void; up: (id: any) => void;
  fontSize?: number; normColor?: string; heldColor?: string;
}) {
  const r = size * 0.38;
  const cx = x + size / 2;
  const cy = y + size / 2;
  return (
    <g>
      <WidgetBase x={x} y={y} w={size} h={size} />
      <Btn cx={cx} cy={cy} r={r} label={label} id={id} held={held} dn={dn} up={up} fontSize={fontSize} normColor={normColor} heldColor={heldColor} />
    </g>
  );
}`;

const replacement = `export function SingleButtonBlock({ x, y, size, label, id, held, dn, up, fontSize, normColor = RED_NORM, heldColor = RED_HELD }: {
  x: number; y: number; size: number; label: React.ReactNode;
  id: string; held: Set<any>; dn: (id: any) => void; up: (id: any) => void;
  fontSize?: number; normColor?: string; heldColor?: string;
}) {
  const r = size * 0.38;
  const cx = x + size / 2;
  const cy = y + size / 2;
  
  let finalLabel = label;
  if (label === "view") {
    finalLabel = (
      <g style={{ stroke: "currentColor", strokeWidth: 2.2, fill: "none" }}>
        <rect x={-8} y={-8} width={16} height={6} rx={1.2} />
        <rect x={-8} y={2} width={16} height={6} rx={1.2} />
      </g>
    );
  } else if (label === "home") {
    finalLabel = <tspan>🎮</tspan>;
    if (!fontSize) fontSize = r * 0.55;
  } else if (label === "menu" || label === "≡") {
    finalLabel = <tspan>≡</tspan>;
    if (!fontSize) fontSize = r * 0.65;
  }

  return (
    <g>
      <WidgetBase x={x} y={y} w={size} h={size} />
      <Btn cx={cx} cy={cy} r={r} label={finalLabel} id={id} held={held} dn={dn} up={up} fontSize={fontSize} normColor={normColor} heldColor={heldColor} />
    </g>
  );
}`;

str = str.replace(target, replacement);

fs.writeFileSync(path, str, 'utf8');
console.log("Updated GamepadWidgets.tsx");
