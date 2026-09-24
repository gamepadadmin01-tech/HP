import type { ReactNode } from 'react';
import { motion, useIsPresent, useReducedMotion } from 'framer-motion';

/** One short fade-through per route. The root waits for exit before entry;
 * nested content must not replay its own entrance when the route mounts. */
export function ShellScreenTransition({ children, direction, className, skipEntrance = false }: {
  children: ReactNode; direction: -1 | 1; className: string; skipEntrance?: boolean;
}) {
  const present = useIsPresent();
  const reduced = useReducedMotion();
  const connectScreen = direction === -1;
  const normalTransition = { duration: reduced ? 0 : .24, ease: [.22, 1, .36, 1] as const };
  return <motion.div
    data-testid={connectScreen ? 'connect-screen-transition' : 'dashboard-screen-transition'}
    // Use settled values, not initial=false: descendants must still animate on tab changes.
    initial={{ opacity: reduced || skipEntrance ? 1 : 0, x: 0, y: reduced || skipEntrance ? 0 : 5 }}
    animate={{ opacity: 1, x: 0, y: 0, transition: normalTransition }}
    variants={{ leaving: { opacity: 0, x: 0, y: 0,
      transition: { duration: reduced ? 0 : .10, ease: 'easeOut' } } }}
    exit="leaving"
    transition={normalTransition}
    style={{ pointerEvents: present ? 'auto' : 'none', backfaceVisibility: 'hidden' }}
    className={className}>
    {children}
  </motion.div>;
}
