/**
 * GOLDEN REFERENCE — functional layer.
 * Copy this file's patterns. It passes check-design.mjs with zero findings.
 *
 * Demonstrates:
 *   - glass via the shared .glass class, never inline
 *   - concentric radii computed, never guessed
 *   - tokens only, no raw values
 *   - transform-only animation
 *   - 44px minimum hit areas
 */
import { type ReactNode, useMemo } from 'react';
import './GlassSheet.css';

/** Apple's concentricity rule: inner = outer - padding, floored at 0. */
export function concentric(outer: number, padding: number): number {
  return Math.max(0, outer - padding);
}

/** Matches --r-sheet / --s-4 in tokens.css. Keep in sync. */
const SHEET_RADIUS = 32;
const SHEET_PADDING = 16;

type Props = {
  title: string;
  children: ReactNode;
  onClose: () => void;
};

export function GlassSheet({ title, children, onClose }: Props) {
  // Children of the sheet nest one level in: 32 - 16 = 16.
  const innerRadius = useMemo(
    () => concentric(SHEET_RADIUS, SHEET_PADDING),
    []
  );

  return (
    <div className="sheet-scrim">
      <section
        className="glass sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="sheet-head">
          <h2 className="sheet-title">{title}</h2>
          <button className="sheet-close press" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        {/* Content layer inside the sheet: flat fill, NOT a second glass pane. */}
        <div
          className="sheet-body"
          style={{ '--inner-radius': `${innerRadius}px` } as React.CSSProperties}
        >
          {children}
        </div>
      </section>
    </div>
  );
}
