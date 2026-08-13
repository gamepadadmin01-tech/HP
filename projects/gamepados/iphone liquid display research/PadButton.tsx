/**
 * GOLDEN REFERENCE — interaction layer.
 * Flat. No glass, no backdrop-filter, no exceptions.
 * Radius and hit test agree (CLAUDE.md §6).
 */
import { useCallback, useRef, useState } from 'react';
import './PadButton.css';

type Props = {
  label: string;
  size: number;
  onPress: (down: boolean) => void;
};

export function PadButton({ label, size, onPress }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [down, setDown] = useState(false);

  /* Pill/circular widget -> radial hit test, matching the visual radius.
     A bounding-box test here would leave the corners functionally live
     but visually dead. */
  const inside = useCallback((x: number, y: number) => {
    const el = ref.current;
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const dx = x - cx;
    const dy = y - cy;
    return dx * dx + dy * dy <= (r.width / 2) * (r.width / 2);
  }, []);

  const handleDown = useCallback(
    (e: React.PointerEvent) => {
      if (!inside(e.clientX, e.clientY)) return;
      setDown(true);
      onPress(true);
    },
    [inside, onPress]
  );

  const handleUp = useCallback(() => {
    setDown(false);
    onPress(false);
  }, [onPress]);

  return (
    <div
      ref={ref}
      className="pad-button"
      data-pressed={down}
      onPointerDown={handleDown}
      onPointerUp={handleUp}
      onPointerCancel={handleUp}
      onPointerLeave={handleUp}
    >
      {label}
    </div>
  );
}
