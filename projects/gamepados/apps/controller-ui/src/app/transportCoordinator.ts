import { rememberMode, cancelPendingWireless } from './store/connectionMemory';
// One owner for automatic USB selection and retries. Timers never own a session.
export type TransportSnapshot = {
  running: boolean; alive: boolean; kind: string; broadcast: string;
  wirelessIntentAt: number; pref: 'auto' | 'tether' | 'usbdebug';
  /** ms since the PC's last ACK; -1 = none since the engine (re)started. */
  sinceAck?: number;
  /** The app is in the background (document.hidden). */
  hidden?: boolean;
  /** A confirmed Wi-Fi PC is saved, so a reconnect (or a return from USB) knows where to go. */
  canRestoreWifi?: boolean;
};

// ── Wi-Fi self-heal (added 2026-10-05) ──────────────────────────────────────
// Leaving the app in recents and coming back stranded Wi-Fi: Android froze the
// app, the PC heard nothing for > 3 s and dropped the phone (and its encryption
// keys), and nothing on the phone ever started a fresh session — the player had
// to scan the QR again. A Wi-Fi link that WAS answering and has been silent for
// WIFI_STALL_MS is now restarted with the saved PC, exactly like a rescan, and
// retried with backoff until the PC answers. Never in the background, and never
// for a link that has not answered once (that is the VPN/firewall "no reply"
// case, where input can still be working).
const WIFI_STALL_MS = 6000;
const WIFI_RETRY_MIN = 8000;
const WIFI_RETRY_MAX = 30000;
export function createTransportCoordinator(io: {
  now: () => number; read: () => TransportSnapshot;
  stopNative: () => void; startTether: (broadcast: string) => void;
  connectDebug: () => void; disconnectDebug: () => void;
  /** Stop the engine and connect again to the saved Wi-Fi PC. */
  restartWireless?: () => void;
}) {
  let explicitUsb = false;
  let explicitWireless = false;
  let unhealthySince: number | null = null;
  let nextAttempt = 0;
  let retryDelay = 4000;
  let stopping = false;
  let starting = false;
  let startRequestedAt = 0;
  let startedBroadcast = '';
  let wifiHealing = false;
  let wifiNext = 0;
  let wifiDelay = WIFI_RETRY_MIN;
  // Wi-Fi → USB (added 2026-10-13). Plugging in a USB-tethering cable while connected over
  // Wi-Fi moves the session to the cable (the steadiest link), once per plug-in. If the
  // cable cannot reach the PC, or is unplugged, the session goes back to the saved Wi-Fi PC.
  let sawNoTether = false;       // the tether has been absent at least once, so its next appearance is a real plug-in
  let tetherSince = 0;           // when the current plug-in was first seen (0 = none, or already there when the app started)
  let explicitWirelessAt = 0;    // last deliberate Wi-Fi choice (QR scan, saved-PC restore)
  let switchTried = 0;           // the plug-in we already switched on (or gave up on): never twice
  let switchedFromWifi = false;  // the current wired session replaced a Wi-Fi one
  let switchedAt = 0;
  let wiredUp = false;           // that wired session answered at least once
  const USB_SWITCH_GIVE_UP_MS = 10000;
  const reset = () => { unhealthySince = null; nextAttempt = 0; retryDelay = 4000; startedBroadcast = ''; };
  function reconcile() {
    const s = io.read(), now = io.now();
    // Native bridge stop is queued on Android's UI thread. Do not open the
    // replacement transport until telemetry confirms the old engine stopped.
    if (stopping) {
      if (s.running) return;
      stopping = false;
    }
    if (starting && s.running) starting = false;
    const tetherAvailable = !!s.broadcast && s.broadcast !== '255.255.255.255';
    if (!tetherAvailable) { sawNoTether = true; tetherSince = 0; switchTried = 0; }
    else if (tetherSince === 0 && sawNoTether) tetherSince = now;
    const backToWifi = () => {
      switchedFromWifi = false; wiredUp = false;
      explicitWireless = true; explicitWirelessAt = now;   // also blocks another switch on this plug-in
      starting = false; stopping = false; reset();
      io.restartWireless!();
    };
    if (switchedFromWifi && !explicitUsb && io.restartWireless && s.canRestoreWifi && !s.hidden) {
      if (s.running && s.kind === 'wired' && s.alive) wiredUp = true;
      // The cable was unplugged, or never reached the PC: return to the Wi-Fi we left.
      if (!tetherAvailable || (!wiredUp && now - switchedAt >= USB_SWITCH_GIVE_UP_MS)) { backToWifi(); return; }
    }
    if (tetherAvailable && tetherSince > 0 && tetherSince !== switchTried && tetherSince > explicitWirelessAt &&
        !explicitUsb && s.pref === 'auto' && s.running && s.kind === 'wireless' && !s.hidden && s.canRestoreWifi) {
      switchTried = tetherSince; switchedFromWifi = true; switchedAt = now; wiredUp = false;
      explicitWireless = false;    // a Wi-Fi choice made BEFORE the cable was plugged in does not outlast it
      io.stopNative(); stopping = true; starting = false; reset();
      return;
    }
    if (s.running && s.kind === 'wireless' && !explicitUsb) {
      if (s.alive) {
        wifiHealing = false; wifiNext = 0; wifiDelay = WIFI_RETRY_MIN;
      } else if (io.restartWireless && s.canRestoreWifi && !s.hidden && now >= wifiNext &&
                 (wifiHealing || (s.sinceAck ?? -1) > WIFI_STALL_MS)) {
        // After the first restart sinceAck reads -1 again, so keep retrying on the
        // backoff until an ACK arrives (wifiHealing), not on sinceAck.
        wifiHealing = true;
        wifiNext = now + wifiDelay; wifiDelay = Math.min(wifiDelay * 2, WIFI_RETRY_MAX);
        io.restartWireless();
        return;
      }
    }
    if (!explicitUsb && (explicitWireless || (s.alive && s.kind === 'wireless') ||
        (s.wirelessIntentAt > 0 && now - s.wirelessIntentAt < 8000))) {
      io.disconnectDebug(); reset(); return;
    }
    const debug = s.pref === 'usbdebug' || (s.pref === 'auto' && !tetherAvailable && (!s.running || explicitUsb));
    if (debug) {
      if (s.running || starting) { io.disconnectDebug(); io.stopNative(); stopping = true; starting = false; reset(); return; }
      io.connectDebug(); return;
    }
    io.disconnectDebug();
    if (starting && !s.running) {
      if (now - startRequestedAt < 4000) return;
      io.stopNative(); stopping = true; starting = false; return;
    }
    // Auto preserves a running Wi-Fi session unless the user explicitly chose USB.
    if (s.running && s.kind !== 'wired' && !explicitUsb && s.pref === 'auto') return;
    const wrongPath = s.running && (s.kind !== 'wired' || !tetherAvailable ||
      (startedBroadcast !== '' && startedBroadcast !== s.broadcast));
    if (wrongPath) { io.stopNative(); stopping = true; reset(); return; }
    if (!tetherAvailable) return;
    if (s.running) {
      if (s.alive) { unhealthySince = null; retryDelay = 4000; return; }
      unhealthySince ??= now;
      // Give native peer rediscovery (3.5 s) time to recover. A failed attempt
      // must release Android's transition guard before trying the directed broadcast.
      if (now - unhealthySince >= 12000) {
        io.stopNative(); stopping = true; unhealthySince = null;
        nextAttempt = now + retryDelay; retryDelay = Math.min(retryDelay * 2, 30000);
      }
      return;
    }
    if (now < nextAttempt) return;
    starting = true; startRequestedAt = now;
    io.startTether(s.broadcast); startedBroadcast = s.broadcast;
    unhealthySince = now; nextAttempt = now + retryDelay;
  }
  return {
    reconcile,
    chooseUsb() { explicitUsb = true; explicitWireless = false; switchedFromWifi = false; reset(); reconcile(); },
    chooseWireless() { explicitUsb = false; explicitWireless = true; explicitWirelessAt = io.now(); switchedFromWifi = false; stopping = false; starting = false; reset(); },
  };
}

export const USB_CHOICE_EVENT = 'gamepados:usb-choice';
export const WIRELESS_CHOICE_EVENT = 'gamepados:wireless-choice';

/** Called once per deliberate QR/manual attempt, never by its verification poll. */
export function prepareWirelessConnection() {
  rememberMode('wireless');
  cancelPendingWireless();
  const w = window as any;
  w.__wirelessIntentAt = Date.now();
  window.dispatchEvent(new Event(WIRELESS_CHOICE_EVENT));
  w.__usbWS?.disconnect();
  // stopEngine and the subsequent connectToPC are queued FIFO on Android's UI thread.
  w.AndroidBridge?.stopEngine?.();
}
