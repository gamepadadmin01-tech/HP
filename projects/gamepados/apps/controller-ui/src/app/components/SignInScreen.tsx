import { useEffect, useRef } from 'react';
import { ArrowLeft } from 'lucide-react';
import { AccountAuth } from './AccountAuth';

/** A dedicated destination, kept simple on purpose: a way back, the sign-in form,
 *  and a way out for people who do not want an account. (The emblem, the
 *  "ONE PROFILE. ALL YOUR PLAY." caption, the backup note and the plans link were
 *  removed on the owner's request, 2026-10-19.) */
export function SignInScreen({ onBack }: { onBack: () => void }) {
  const screen = useRef<HTMLElement>(null);
  useEffect(() => { screen.current?.focus({ preventScroll: true }); }, []);
  return <section ref={screen} tabIndex={-1} className="console-signin" data-testid="sign-in-screen" aria-label="Sign in to GamepadOS">
    <div className="console-signin-top">
      <button data-testid="signin-back-button" className="calm-text-button" onClick={onBack}><ArrowLeft size={16} />Back</button>
    </div>
    <AccountAuth standalone />
    <div className="console-signin-footer">
      <button data-testid="signin-continue-guest-button" className="calm-text-button" onClick={onBack}>Continue without signing in</button>
    </div>
  </section>;
}
