import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowUpRight, Gamepad2, Usb, Wifi } from 'lucide-react';
import hardware from '../../assets/hardware.webp';

export function ConsoleHero({ name, onLaunch }: { name: string; onLaunch: () => void }) {
  const reduced = useReducedMotion();
  return <motion.section className="console-hero" data-testid="session-hero"
    initial={{ opacity: 0, y: reduced ? 0 : 18 }} animate={{ opacity: 1, y: 0 }}
    transition={{ type: 'spring', stiffness: 260, damping: 28 }}>
    <div className="console-spectrum" aria-hidden="true" />
    <div className="console-hero-top"><span className="console-eyebrow">PHONE TO GAMEPAD</span><Gamepad2 size={19} /></div>
    <div className="console-art" aria-hidden="true">
      <span className="console-art-label">G / OS</span>
      <motion.img src={hardware} alt="" initial={{ opacity: 0, rotate: reduced ? 0 : -5, scale: reduced ? 1.3 : 1.15 }}
        animate={{ opacity: 1, rotate: 0, scale: 1.3 }} transition={{ duration: .7, ease: [.16, 1, .3, 1] }} />
      <span className="console-art-caption">BUILT FOR YOUR NEXT MOVE</span>
    </div>
    <div className="console-hero-info"><div><span className="console-eyebrow">READY TO LAUNCH</span><AnimatePresence mode="wait" initial={false}><motion.h2 key={name} data-testid="selected-controller-name" initial={{ opacity: 0, y: reduced ? 0 : 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0 : .12 }}>{name}</motion.h2></AnimatePresence></div><ArrowUpRight className="console-hero-symbol" size={26} aria-hidden="true" /></div>
    <motion.button data-no-shell-press data-testid="launch-controller-button" className="calm-primary console-launch" onClick={onLaunch}
      whileTap={reduced ? undefined : { scale: .97 }} transition={{ type: 'spring', stiffness: 400, damping: 30 }}>
      <Gamepad2 size={19} />Let’s play<ArrowUpRight size={19} />
    </motion.button>
    <div className="console-hero-foot"><span><Wifi size={12} />Wireless</span><i /><span><Usb size={12} />USB ready</span><span className="console-hero-foot-end">MADE TO MOVE.</span></div>
  </motion.section>;
}