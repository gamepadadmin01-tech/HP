// ─── Pad repository ───────────────────────────────────────────────────────────
//
// The only code that reads or writes saved controller layouts. Local storage is
// authoritative and every write lands immediately — a layout must never wait on
// a network, an account, or anything else. Cloud sync, when it arrives, becomes
// a reconciler behind this same interface rather than a second code path in the
// UI. That is what keeps guest and signed-in users on identical behaviour.

import { CustomPad, CustomBtnDef, BtnId, PosOverrideMap } from "../types";
import { KEYS, readJson, writeJson } from "./storage";

/** Widget id. Moved here from App.tsx because pad migrations mint ids and the
 *  repository is now what owns pad shape. */
export const mkUid = () => `cb${Math.random().toString(36).slice(2, 14)}`;

// ─── Migrations ───────────────────────────────────────────────────────────────

// Saved pads from versions <= 1.3.7 may still contain the legacy "ltrt" compound
// widget (LT+RT fused as one unit). Split it into two independent "trigger"
// widgets with the exact same on-screen footprint (pill w=r, h=r*5.85, r*0.13
// centre gap) so old layouts look identical but each trigger now selects,
// moves and resizes on its own in the editor.
export function splitLegacyLtrt(pads: CustomPad[]): CustomPad[] {
  return pads.map((p) => ({
    ...p,
    buttons: (p.buttons || []).flatMap((b) => {
      if ((b.type as string) !== "ltrt") return [b];
      const pillW = b.r, pillH = b.r * 5.85, gap = b.r * 0.13;
      const mk = (label: string, cx: number): CustomBtnDef => ({
        ...b, uid: mkUid(), type: "trigger", shape: "rect", label,
        x: cx, w: pillW, h: pillH, macroBits: [],
      });
      return [
        mk("LT", b.x - gap / 2 - pillW / 2),
        mk("RT", b.x + gap / 2 + pillW / 2),
      ];
    }),
  }));
}

/** Every stored-shape fix, applied in order on load. Must be idempotent: pads
 *  are re-normalised on every launch, not just once. */
function normalise(pads: CustomPad[]): CustomPad[] {
  return splitLegacyLtrt(pads);
}

// ─── Validation ───────────────────────────────────────────────────────────────

/** Cheap structural check. A pad missing padId or buttons cannot be rendered,
 *  and one bad entry must not take the whole library down with it. */
function isPadLike(value: unknown): value is CustomPad {
  if (typeof value !== "object" || value === null) return false;
  const p = value as Partial<CustomPad>;
  return typeof p.padId === "string" && Array.isArray(p.buttons);
}

function isPadArray(value: unknown): value is CustomPad[] {
  return Array.isArray(value);
}

// ─── Change stamps ────────────────────────────────────────────────────────────
//
// `updatedAt` is written whenever a pad's content changes, so that saving to an
// account later can tell which copy is newer without guessing. Written now
// because retrofitting it would leave every existing pad undated.
//
// Only pads that actually changed are re-stamped — stamping the whole array on
// every save would make every pad look edited and defeat the purpose.

function contentOf(pad: CustomPad): string {
  return JSON.stringify({ name: pad.name, color: pad.color, buttons: pad.buttons });
}

// ─── Share fingerprint ────────────────────────────────────────────────────────

/** Fingerprint of the shareable content of a pad. Purely local: it answers "has
 *  this layout changed since I last shared it", so a repeat Share tap can reuse
 *  the stored code without touching the network. It does NOT have to match the
 *  server's hash — that one dedupes rows globally and is computed there. */
export async function shareFingerprint(pad: CustomPad): Promise<string> {
  // Widget uids are excluded to match what the server hashes: import mints new
  // uids, so they mean nothing to a recipient, and ignoring them keeps the code
  // stable when only uids differ.
  const text = JSON.stringify({
    name: pad.name,
    color: pad.color,
    buttons: (pad.buttons || []).map(({ uid, ...rest }) => rest),
  });
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    try {
      const buf = await subtle.digest("SHA-256", new TextEncoder().encode(text));
      return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
    } catch {
      /* fall through to the cheap hash */
    }
  }
  // Old WebViews without crypto.subtle: FNV-1a plus the length. A collision here
  // would only mean an unnecessary re-share, never a wrong code, because the
  // server still decides what the code is.
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `f${h.toString(16)}-${text.length}`;
}

function stampChanged(next: CustomPad[], prev: CustomPad[]): CustomPad[] {
  const prevById = new Map(prev.map((p) => [p.padId, p]));
  const now = new Date().toISOString();
  return next.map((pad) => {
    const before = prevById.get(pad.padId);
    if (before && contentOf(before) === contentOf(pad) && pad.updatedAt) return pad;
    return { ...pad, updatedAt: now };
  });
}

// ─── Repository ───────────────────────────────────────────────────────────────

// What is currently on disk. Held so a save does not have to re-read and
// re-parse the whole library just to work out which pads actually changed —
// the editor writes on every commit, and pads carry every widget's geometry.
let onDisk: CustomPad[] | null = null;

/** All saved pads, migrated and validated. Never throws; a corrupt store yields
 *  an empty library rather than a dead app. */
export function loadPads(): CustomPad[] {
  if (onDisk) return onDisk;
  const raw = readJson<CustomPad[]>(KEYS.customPads, [], isPadArray);
  const usable = raw.filter(isPadLike);
  if (usable.length !== raw.length) {
    console.warn(`[pads] dropped ${raw.length - usable.length} unreadable pad(s)`);
  }
  onDisk = normalise(usable);
  return onDisk;
}

/** Persist the library. Returns false when storage refused the write, so the
 *  caller can tell the user their layout will not survive a restart instead of
 *  pretending it saved. */
export function savePads(pads: CustomPad[]): boolean {
  const stamped = stampChanged(pads, loadPads());
  const ok = writeJson(KEYS.customPads, stamped);
  // Only adopt the new snapshot if it really landed; otherwise the cache would
  // claim a write succeeded that storage rejected.
  if (ok) onDisk = stamped;
  return ok;
}

/** Count for the Account hub. Real number or nothing — never a placeholder. */
export function padCount(): number {
  return loadPads().length;
}

// ─── Tombstones ───────────────────────────────────────────────────────────────
//
// A deleted pad has to be remembered, not just removed. Sync merges by padId,
// so "absent from this device" cannot mean "delete it" — a fresh install would
// wipe the whole account. A tombstone says deleted, and when.

export type Tombstone = { padId: string; deletedAt: string };

export function loadTombstones(): Tombstone[] {
  const raw = readJson<Tombstone[]>(KEYS.deletedPads, [], (v): v is Tombstone[] => Array.isArray(v));
  return raw.filter((t) => t && typeof t.padId === "string" && typeof t.deletedAt === "string");
}

export function addTombstone(padId: string): void {
  const list = loadTombstones().filter((t) => t.padId !== padId);
  list.push({ padId, deletedAt: new Date().toISOString() });
  // Keep the list bounded; the oldest deletes have long since reached every
  // device that will ever care.
  writeJson(KEYS.deletedPads, list.slice(-200));
}

/** Drop tombstones the server has confirmed, so the list does not grow forever. */
export function pruneTombstones(keepPadIds: Set<string>): void {
  writeJson(KEYS.deletedPads, loadTombstones().filter((t) => keepPadIds.has(t.padId)));
}

// Sync rewrites storage from outside React, so anything rendering the library
// has to be told. Without this the Account count and the pad list would keep
// showing the pre-sync state until the next remount.
const padListeners = new Set<(pads: CustomPad[]) => void>();

export function onPadsReplaced(fn: (pads: CustomPad[]) => void): () => void {
  padListeners.add(fn);
  return () => padListeners.delete(fn);
}

/** Replace the whole library — used by sync when adopting the merged result. */
export function replacePads(pads: CustomPad[]): boolean {
  const ok = writeJson(KEYS.customPads, pads);
  if (ok) {
    onDisk = pads;
    padListeners.forEach((fn) => fn(pads));
  }
  return ok;
}

// ─── Preset customisation ─────────────────────────────────────────────────────
//
// Edits applied on top of a built-in preset: remapped buttons and dragged widget
// positions. Kept separate from the presets themselves so a preset can be
// updated in a release without discarding what the user changed.

export type PresetOverrides = Record<string, Partial<Record<BtnId, string>>>;
export type PosOverrides = Record<string, PosOverrideMap>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function loadPresetOverrides(): PresetOverrides {
  return readJson<PresetOverrides>(KEYS.presetOverrides, {}, isRecord as (v: unknown) => v is PresetOverrides);
}

export function savePresetOverrides(v: PresetOverrides): boolean {
  return writeJson(KEYS.presetOverrides, v);
}

export function loadPosOverrides(): PosOverrides {
  return readJson<PosOverrides>(KEYS.posOverrides, {}, isRecord as (v: unknown) => v is PosOverrides);
}

export function savePosOverrides(v: PosOverrides): boolean {
  return writeJson(KEYS.posOverrides, v);
}

/** How many built-in presets ship with the app. Passed in by the caller that
 *  owns the preset list, so this module never has to guess a count. */
export function standardLayoutCount(presets: readonly unknown[]): number {
  return presets.length;
}
