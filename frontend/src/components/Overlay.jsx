'use client';

import { createContext, useContext, useRef, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';

const InsideOverlay = createContext(false);
const subscribe = () => () => {};

/**
 * A `position: fixed` layer — popup, backdrop, drawer, lightbox — that is always laid out
 * against the screen. Use it instead of a plain `<div className="fixed inset-0 …">`.
 *
 * "Fixed" only means "the screen" while no ancestor carries a transform, filter or
 * backdrop-filter. Every `backdrop-blur-*` card, every slider that moves with
 * `translate`, is such an ancestor: a popup written inside one is pinned to that box
 * instead, and on a phone it opens somewhere down the page, out of sight. So the layer is
 * rendered outside the page tree — in the dashboard's `#overlay-root`, which keeps the
 * shell's text colour and font, or on <body> everywhere else.
 *
 * An Overlay opened from inside another one stays where it is written: its parent is
 * already on the screen, and staying inside it keeps it stacked above that parent.
 */
export default function Overlay({ children, ...props }) {
  const nested = useContext(InsideOverlay);
  // False on the server and while hydrating, so the first client render matches the HTML.
  const onClient = useSyncExternalStore(subscribe, () => true, () => false);

  const layer = (
    <InsideOverlay.Provider value={true}>
      <div {...props}>{children}</div>
    </InsideOverlay.Provider>
  );

  // Chosen once and kept: a different target on a later render would remount the popup
  // and drop the focus out of whatever field is being typed in.
  const target = useRef(null);
  if (onClient && !target.current?.isConnected) {
    target.current = document.getElementById('overlay-root') || document.body;
  }

  if (nested || !onClient) return layer;
  return createPortal(layer, target.current);
}
