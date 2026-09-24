import { useEffect } from 'react';
import { animate } from 'framer-motion';

let users = 0;
let teardown: (() => void) | undefined;
const selector = '.gp-shell button, .gp-shell input, .gp-shell textarea, .gp-shell [role="dialog"]';

/** One delegated listener/observer, shared even while two screens transition. */
function install() {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const animations = new Map<HTMLElement, ReturnType<typeof animate>>();
  const pending = new Set<Element>();
  let frame = 0;
  const identify = (root: Element) => {
    const elements = [...(root.matches(selector) ? [root] : []), ...root.querySelectorAll(selector)];
    elements.forEach(el => {
      if (!(el instanceof HTMLElement) || el.dataset.testid || el.closest('.calm-pad-preview')) return;
      const label = el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.id || el.textContent || el.getAttribute('role') || 'field';
      el.dataset.testid = `${label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 65)}-${el.tagName.toLowerCase()}`;
    });
  };
  const press = (event: PointerEvent) => {
    if (reduced.matches || event.button !== 0 || !(event.target instanceof Element)) return;
    const button = event.target.closest<HTMLElement>('.gp-shell button');
    if (!button || button.hasAttribute('disabled') || button.hasAttribute('data-no-shell-press') || button.closest('.calm-pad-preview')) return;
    animations.get(button)?.stop();
    animations.set(button, animate(button, { scale: .97 }, { duration: .08 }));
  };
  const release = () => animations.forEach((animation, button) => {
    animation.stop();
    animations.delete(button);
    if (button.isConnected) animate(button, { scale: 1 }, { duration: reduced.matches ? 0 : .16 });
  });
  identify(document.body);
  const observer = new MutationObserver(records => {
    records.forEach(record => record.addedNodes.forEach(node => { if (node instanceof Element) pending.add(node); }));
    if (!pending.size || frame) return;
    frame = requestAnimationFrame(() => {
      pending.forEach(node => { if (node.isConnected) identify(node); });
      pending.clear(); frame = 0;
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });
  document.addEventListener('pointerdown', press, { passive: true });
  document.addEventListener('pointerup', release, { passive: true });
  document.addEventListener('pointercancel', release, { passive: true });
  window.addEventListener('blur', release);
  return () => {
    observer.disconnect(); cancelAnimationFrame(frame); pending.clear();
    document.removeEventListener('pointerdown', press);
    document.removeEventListener('pointerup', release);
    document.removeEventListener('pointercancel', release);
    window.removeEventListener('blur', release);
    animations.forEach(animation => animation.stop()); animations.clear();
  };
}

export function ShellMotion() {
  useEffect(() => {
    if (users++ === 0) teardown = install();
    return () => { if (--users === 0) { teardown?.(); teardown = undefined; } };
  }, []);
  return null;
}