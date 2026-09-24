import { rememberMode, cancelPendingWireless } from './store/connectionMemory';
// One owner for automatic USB selection and retries. Timers never own a session.
export type TransportSnapshot = {
  running: boolean; alive: boolean; kind: string; broadcast: string;
  wirelessIntentAt: number; pref: 'auto' | 'tether' | 'usbdebug';
};
export function createTransportCoordinator(io: {
  now: () => number; read: () => TransportSnapshot;
  stopNative: () => void; startTether: (broadcast: string) => void;
  connectDebug: () => void; disconnectDebug: () => void;
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
    if (!explicitUsb && (explicitWireless || (s.alive && s.kind === 'wireless') ||
        (s.wirelessIntentAt > 0 && now - s.wirelessIntentAt < 8000))) {
      io.disconnectDebug(); reset(); return;
    }
    const tetherAvailable = !!s.broadcast && s.broadcast !== '255.255.255.255';
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
    chooseUsb() { explicitUsb = true; explicitWireless = false; reset(); reconcile(); },
    chooseWireless() { explicitUsb = false; explicitWireless = true; stopping = false; starting = false; reset(); },
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
