'use client';

import { Children, useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * A row of cards that slides sideways, the way Amazon's home-page rows do: as many cards as
 * fit and the edge of the next, a swipe on a phone, and from `sm` up an arrow at each end
 * that moves the row by the cards on screen. An arrow shows only while there is more that way.
 *
 * The arrows scroll by physical left/right (scrollBy), which is the same in Arabic and in
 * English; only "is there more on this side" depends on the direction, because in RTL the
 * browser counts scrollLeft down from 0.
 *
 * `itemClassName` is each card's width. The section around it pads its content by 1rem
 * (`px-4`); on a phone the row reaches past that to the screen's edges so cards slide out of
 * view rather than being cut at the padding.
 */
export default function CardSlider({ children, itemClassName = 'w-[80%] sm:w-[300px]', isAr = false }) {
  const trackRef = useRef(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);
  const count = Children.count(children);

  const update = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    const max = track.scrollWidth - track.clientWidth;
    const x = track.scrollLeft;
    if (getComputedStyle(track).direction === 'rtl') {
      setCanLeft(x > -max + 1);
      setCanRight(x < -1);
    } else {
      setCanLeft(x > 1);
      setCanRight(x < max - 1);
    }
  }, []);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return undefined;
    update();
    track.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(track);
    return () => {
      track.removeEventListener('scroll', update);
      observer.disconnect();
    };
  }, [update, count]);

  /** One screenful: the cards that are fully on screen, so the next one lands at the edge. */
  const move = (sign) => {
    const track = trackRef.current;
    const first = track?.firstElementChild;
    if (!track || !first) return;
    const styles = getComputedStyle(track);
    const gap = parseFloat(styles.columnGap || styles.gap) || 0;
    const step = first.getBoundingClientRect().width + gap;
    const fit = Math.max(1, Math.floor((track.clientWidth + gap) / step));
    track.scrollBy({ left: sign * fit * step, behavior: 'smooth' });
  };

  return (
    <div className="relative">
      <SliderArrow
        side="left"
        show={canLeft}
        label={isAr ? 'تحريك لليسار' : 'Scroll left'}
        onClick={() => move(-1)}
      />

      {/* py: room for a card's hover lift and shadow, which the scrolling row would clip. */}
      <div
        ref={trackRef}
        className="flex gap-3 sm:gap-5 overflow-x-auto scrollbar-hide snap-x snap-mandatory scroll-smooth
          -mx-4 px-4 scroll-px-4 sm:mx-0 sm:px-0 sm:scroll-px-0 py-2"
        style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}
      >
        {Children.map(children, (child) => (
          // `flex` + `w-full`: every card as tall as the tallest in the row.
          <div className={`flex flex-none snap-start [&>*]:w-full ${itemClassName}`}>{child}</div>
        ))}
      </div>

      <SliderArrow
        side="right"
        show={canRight}
        label={isAr ? 'تحريك لليمين' : 'Scroll right'}
        onClick={() => move(1)}
      />
    </div>
  );
}

/** Amazon's tall white tab at the row's edge, over the cards. Hidden on a phone, which swipes. */
function SliderArrow({ side, show, label, onClick }) {
  const Icon = side === 'left' ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      aria-label={label}
      aria-hidden={!show}
      tabIndex={show ? 0 : -1}
      onClick={onClick}
      className={`hidden sm:flex absolute top-1/2 -translate-y-1/2 z-10 ${side === 'left' ? 'left-0 sm:-left-2 rounded-e-xl' : 'right-0 sm:-right-2 rounded-s-xl'}
        h-24 w-11 items-center justify-center bg-white/95 border border-marine-teal/15 shadow-[0_4px_16px_rgba(0,0,0,0.15)]
        text-marine-ink hover:bg-white hover:text-marine-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marine-cyan
        transition-opacity duration-200 ${show ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
    >
      <Icon size={26} strokeWidth={2.5} />
    </button>
  );
}
