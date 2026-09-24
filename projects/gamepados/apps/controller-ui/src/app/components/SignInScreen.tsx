import { useEffect, useRef } from 'react';
import { ArrowLeft, ArrowUpRight, Gamepad2, ShieldCheck } from 'lucide-react';
import { AccountAuth } from './AccountAuth';

/** A dedicated destination, not a plans page with an expanded form. */
export function SignInScreen({ onBack, onPlans }: { onBack: () => void; onPlans: () => void }) {
  const screen = useRef<HTMLElement>(null);
  useEffect(() => { screen.current?.focus({ preventScroll: true }); }, []);
  return <section ref={screen} tabIndex={-1} className="console-signin" data-testid="sign-in-screen" aria-label="Sign in to GamepadOS">
    <div className="console-signin-top">
      <button data-testid="signin-back-button" className="calm-text-button" onClick={onBack}><ArrowLeft size={16} />Back</button>
      <span className="console-eyebrow">PLAYER ACCESS / 01</span>
    </div>
    <div className="console-player-emblem" aria-hidden="true">
      <span className="console-emblem-orbit" /><span className="console-emblem-orbit console-emblem-orbit-inner" />
      <span className="console-emblem-core"><Gamepad2 size={35} strokeWidth={1.5} /></span>
      <span className="console-emblem-caption">ONE PROFILE. ALL YOUR PLAY.</span>
    </div>
    <AccountAuth standalone />
    <div className="console-signin-footer">
      <span><ShieldCheck size={14} />Your layouts, safely backed up.</span>
      <button data-testid="signin-continue-guest-button" className="calm-secondary" onClick={onBack}>Continue without signing in<ArrowUpRight size={16} /></button>
      <button data-testid="signin-view-plans-button" className="calm-text-button" onClick={onPlans}>Looking for more playtime? View plans<ArrowUpRight size={14} /></button>
    </div>
  </section>;
}