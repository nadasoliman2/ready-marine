'use client';

import { useEffect } from 'react';

/**
 * Closes a small open menu on a press anywhere outside `ref`, or on Escape.
 *
 * For menus that open on a click and must STAY open while the pointer travels to an option:
 * a menu that opens on hover closes in the gap between its button and its list, and a phone
 * has no hover at all.
 */
export default function useDismiss(ref, open, close) {
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event) => { if (ref.current && !ref.current.contains(event.target)) close(); };
    const onKey = (event) => { if (event.key === 'Escape') close(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [ref, open, close]);
}
