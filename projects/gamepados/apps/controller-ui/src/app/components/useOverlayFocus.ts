import { useEffect, useRef, type RefObject } from "react";

const backClosers: Array<() => void> = [];
export function closeTopOverlay() {
  const close = backClosers[backClosers.length - 1];
  if (!close) return false;
  close(); return true;
}

/** Focus only the active overlay; return to the control that opened it. */
export function useOverlayFocus(open: boolean, root: RefObject<HTMLElement | null>, close: () => void) {
  const latestClose=useRef(close);latestClose.current=close;
  useEffect(()=>{
    if(!open)return;
    const backClose = () => latestClose.current();
    backClosers.push(backClose);
    const previous=document.activeElement as HTMLElement | null;
    const items=()=>Array.from(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href],[tabindex="0"]')||[]).filter(e=>e.getClientRects().length>0);
    const frame=requestAnimationFrame(()=>items()[0]?.focus({preventScroll:true}));
    const key=(e:KeyboardEvent)=>{
      if(e.key==='Escape'){e.preventDefault();e.stopPropagation();latestClose.current();return;}
      if(e.key!=='Tab')return;
      const list=items(),first=list[0],last=list[list.length-1];if(!first){e.preventDefault();return;}
      if(e.shiftKey&&(document.activeElement===first||!root.current?.contains(document.activeElement))){e.preventDefault();last.focus();}
      else if(!e.shiftKey&&(document.activeElement===last||!root.current?.contains(document.activeElement))){e.preventDefault();first.focus();}
    };
    document.addEventListener('keydown',key,true);
    return ()=>{const index=backClosers.indexOf(backClose);if(index>=0)backClosers.splice(index,1);cancelAnimationFrame(frame);document.removeEventListener('keydown',key,true);if(previous?.isConnected)previous.focus({preventScroll:true});};
  },[open,root]);
}
