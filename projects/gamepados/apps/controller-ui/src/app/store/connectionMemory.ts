import { KEYS, readJson, readString, writeJson, writeString } from './storage';

export type SavedPc = { ip: string; port: number; key: string };
let pending: SavedPc | null = null;
export function savedPc(): SavedPc | null {
  const p = readJson<SavedPc | null>(KEYS.lastPc, null);
  if (!p || typeof p.ip !== 'string' || !/^\d{1,3}(\.\d{1,3}){3}$/.test(p.ip) ||
      !p.ip.split('.').every(n => +n <= 255) || !Number.isInteger(p.port) || p.port < 1 || p.port > 65535 ||
      (p.key !== 'manual' && !/^[a-fA-F0-9]{8}$/.test(p.key))) return null;
  return p;
}
export function connectionMode(): string { return readString(KEYS.connectionMode, 'auto'); }
export function rememberMode(mode: 'wireless' | 'usb') { writeString(KEYS.connectionMode, mode); }
export function pendingWireless(pc: SavedPc) { pending = pc; }
export function confirmWireless(t: { linkAlive?: boolean; connectionType?: string }) {
  if (pending && t.linkAlive && t.connectionType === 'wireless') {
    // Save only after a PC replied. A mistyped address must not replace a working pairing.
    writeJson(KEYS.lastPc, pending); pending = null;
  }
}
export function cancelPendingWireless() { pending = null; }
export function selectedLayout() { return readString(KEYS.selectedLayout, 'xbox'); }
export function rememberLayout(id: string) { writeString(KEYS.selectedLayout, id); }
export function dashboardTab(): 'home' | 'system' | 'account' {
  const tab = readString(KEYS.dashboardTab, 'home');
  return tab === 'system' || tab === 'account' ? tab : 'home';
}
export function rememberTab(tab: string) { writeString(KEYS.dashboardTab, tab); }
