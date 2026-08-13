/**
 * What the connection indicator should actually say.
 *
 * ## Why this exists
 *
 * The UI used to render one boolean: `linkAlive ? "CONNECTED" : "DISCONNECTED"`.
 * `linkAlive` is true only when the PC's ACK arrived within 2.5 s, which is the
 * right definition of connected — but it makes **every** failure look identical,
 * and they are not.
 *
 * On 2026-08-10 a PC-side VPN broke only the PC -> phone direction. Input worked
 * perfectly, the PC showed the phone as connected, and the app said
 * DISCONNECTED. The label was technically defensible and practically useless:
 * it pointed at the link being dead when the link was half alive, and it gave no
 * hint that the return path was the thing to look at.
 *
 * The information to tell these apart was already in the native layer, just
 * never exported. `sinceAck === -1` means "we have been transmitting and the PC
 * has never once answered" — a completely different diagnosis from "it answered
 * a moment ago and stopped".
 *
 * ## The states
 *
 * - `connected` — ACK within 2.5 s. Everything is fine.
 * - `no-reply`  — we are transmitting; the PC has NEVER answered. Wrong IP, or
 *                 something is eating the return path (VPN, firewall). **Input
 *                 may well be working** — that is the whole point of the state.
 * - `stalled`   — it was answering and went quiet. Server closed, PC asleep,
 *                 Wi-Fi dropped.
 * - `off`       — not transmitting at all. The honest "disconnected".
 *
 * Kept as a separate pure module rather than inlined in App.tsx: App.tsx is
 * ~4600 lines with mixed line endings and a corruption incident behind it, so
 * new logic that does not have to live there should not.
 */

export type LinkState = "connected" | "no-reply" | "stalled" | "off";

/** The subset of the native telemetry blob this cares about. */
export interface LinkTelemetry {
  linkAlive?: boolean;
  engineRunning?: boolean;
  packetCount?: number;
  /** ms since the last ACK; **-1 means none has ever arrived**. */
  sinceAck?: number;
  connectionType?: string;
}

/**
 * Classify the link.
 *
 * Degrades safely on an older Android build whose telemetry predates
 * `sinceAck`: without it we cannot separate never-answered from went-quiet, so
 * a transmitting-but-silent link reports `no-reply`. That is the more
 * actionable of the two and, unlike the old behaviour, still not a lie.
 */
export function linkState(t: LinkTelemetry | null | undefined): LinkState {
  if (!t) return "off";
  // The USB-debug WebSocket path synthesises `{linkAlive:true}` with no engine
  // fields, so this must stay the first check.
  if (t.linkAlive) return "connected";
  if (!t.engineRunning) return "off";
  // Transmitting, but nothing is coming back.
  if (typeof t.sinceAck === "number") {
    return t.sinceAck < 0 ? "no-reply" : "stalled";
  }
  return "no-reply";
}

/** Short label for the header badge. Space is tight — keep these brief. */
export function linkLabel(s: LinkState): string {
  switch (s) {
    case "connected":
      return "CONNECTED";
    case "no-reply":
      return "NO REPLY";
    case "stalled":
      return "LINK LOST";
    default:
      return "DISCONNECTED";
  }
}

/**
 * One sentence a user can act on. Deliberately names the likely cause rather
 * than describing the symptom back at them.
 */
export function linkHint(s: LinkState): string {
  switch (s) {
    case "connected":
      return "Controller ready.";
    case "no-reply":
      return "Sending input, but the PC isn't answering. The controller may still work. Check a VPN or firewall on the PC — it can block replies while letting input through.";
    case "stalled":
      return "The PC stopped answering. Check the server is still running.";
    default:
      return "Not connected to a PC.";
  }
}

/** Indicator colour. `no-reply`/`stalled` are amber: degraded, not dead. */
export function linkColor(s: LinkState): string {
  switch (s) {
    case "connected":
      return "#34d399";
    case "no-reply":
    case "stalled":
      return "#fbbf24";
    default:
      return "#ef4444";
  }
}
