import React, { useRef, useState } from 'react';
import { getAppInfo, openUrl } from '../platform/native';
import { WEBSITE_ACCOUNT, websitePlansUrl } from '../store/websitePlans';

export function PlayBillingNotice() {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const opening = useRef(false);
  const open = (url: string) => {
    if ((window as any).AndroidBridge?.openUrl) openUrl(url);
    else window.location.assign(url);
  };
  const explore = async () => {
    if (opening.current) return;
    opening.current = true;
    setBusy(true); setFailed(false);
    try { open(await websitePlansUrl()); }
    catch { setFailed(true); }
    finally { opening.current = false; setBusy(false); }
  };
  if (getAppInfo().channel !== 'playstore') return null;
  return <section className="calm-surface p-4 space-y-2" data-testid="play-billing-notice">
    <p className="text-sm font-semibold calm-ink">Google Play billing will be available soon.</p>
    <p className="text-sm calm-muted">Already have a plan? Sign in to use it.</p>
    <button type="button" className="w-full rounded-xl px-4 py-3 font-semibold disabled:opacity-50" style={{ background: 'var(--calm-accent)', color: 'var(--calm-on-accent)' }} disabled={busy} onClick={explore} data-testid="website-plans-button">
      {busy ? 'Opening website…' : 'Explore plans on website'}
    </button>
    {failed && <div role="status" className="text-sm calm-muted">
      Automatic sign-in is unavailable. You can sign in on the website with the same account.
      <button type="button" className="underline" onClick={() => open(WEBSITE_ACCOUNT)}>Continue to website</button>
    </div>}
  </section>;
}
