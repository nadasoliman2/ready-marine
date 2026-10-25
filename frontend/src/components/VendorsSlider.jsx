'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from './LocaleLink';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { vendorApi } from '../lib/api';
import VendorCard from './VendorCard';

/**
 * The vendors strip on the home page.
 *
 * Three things decide whether this moves at all, and the old version got each one wrong
 * on a phone:
 *
 *  · how many cards fit is MEASURED, not assumed. With "4 fit" hard-coded and three
 *    vendors on the home page, there was nothing to scroll to on a desktop — and on a
 *    phone, where one card fits, the other two were cut off with no way to reach them;
 *  · the track scrolls natively, so a finger can drag it. Arrows and autoplay drive the
 *    same scroll position, so the three never disagree about where the strip is;
 *  · a person's swipe wins. Autoplay backs off for a while after any touch, and the
 *    active index is read back from where they left the strip rather than snapping it
 *    to wherever the timer thought it was.
 */

// How long autoplay stays out of the way after the person moves the strip themselves.
const RESUME_AFTER_MS = 6000;
const AUTOPLAY_MS = 3000;

export default function VendorsSlider() {
  const { language } = useApp();
  const isAr = language === 'ar';
  const sectionRef = useRef(null);
  const trackRef = useRef(null);
  const [vendors, setVendors] = useState([]);
  const [activeIndex, setActiveIndex] = useState(0);
  // Cards that fit side by side in the track, from the track's real width.
  const [visible, setVisible] = useState(1);
  const [hovered, setHovered] = useState(false);
  const [isInView, setIsInView] = useState(false);
  // Set while the person is dragging or just has. Held in state so the autoplay effect
  // re-evaluates when it lifts.
  const [userBusy, setUserBusy] = useState(false);
  const resumeTimer = useRef(null);
  const settleTimer = useRef(null);

  useEffect(() => {
    let active = true;
    vendorApi.getPublicVendors({ placement: 'home', limit: 12 })
      .then(data => {
        if (active) setVendors(data.vendors || []);
      })
      .catch(() => {
        if (active) setVendors([]);
      });
    return () => { active = false; };
  }, []);

  /** Distance from one card's start to the next: its width plus the flex gap. */
  const stepSize = useCallback(() => {
    const track = trackRef.current;
    const first = track?.firstElementChild;
    if (!track || !first) return 0;
    const styles = getComputedStyle(track);
    const gap = parseFloat(styles.columnGap || styles.gap) || 0;
    return first.getBoundingClientRect().width + gap;
  }, []);

  // Re-measured whenever the track changes size, which is what a phone rotating or a
  // window narrowing is. `visible` is what turns the arrows and autoplay on.
  useEffect(() => {
    const track = trackRef.current;
    if (!track || vendors.length === 0) return undefined;
    const measure = () => {
      const step = stepSize();
      if (!step) return;
      const styles = getComputedStyle(track);
      const gap = parseFloat(styles.columnGap || styles.gap) || 0;
      setVisible(Math.max(1, Math.floor((track.clientWidth + gap) / step)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(track);
    return () => observer.disconnect();
  }, [vendors.length, stepSize]);

  const max = Math.max(0, vendors.length - visible);

  // A resize that fits more cards can leave the index past the new end.
  useEffect(() => {
    setActiveIndex(prev => Math.min(prev, max));
  }, [max]);

  const scroll = (dir) => {
    setActiveIndex(prev => {
      const forward = isAr ? dir === 'left' : dir === 'right';
      return forward ? Math.min(prev + 1, max) : Math.max(prev - 1, 0);
    });
  };

  useEffect(() => {
    const section = sectionRef.current;
    if (!section || vendors.length === 0) return undefined;

    const observer = new IntersectionObserver(
      ([entry]) => setIsInView(entry.isIntersecting),
      { threshold: 0.2 }
    );

    observer.observe(section);
    return () => observer.disconnect();
  }, [vendors.length]);

  useEffect(() => {
    if (!isInView || hovered || userBusy || max === 0) return undefined;
    const interval = setInterval(() => setActiveIndex(prev => (prev >= max ? 0 : prev + 1)), AUTOPLAY_MS);
    return () => clearInterval(interval);
  }, [isInView, hovered, userBusy, max]);

  // The index drives the scroll position. In RTL the browser counts scrollLeft downwards
  // from zero, so the same index is a negative offset.
  useEffect(() => {
    const track = trackRef.current;
    if (!track || vendors.length === 0) return;
    const step = stepSize();
    if (!step) return;
    const target = activeIndex * step;
    track.scrollTo({ left: isAr ? -target : target, behavior: 'smooth' });
  }, [activeIndex, vendors.length, isAr, stepSize]);

  /**
   * The person moved the strip. Hold autoplay off, and once the scroll settles read the
   * index back from where they left it, so the next arrow press or autoplay tick starts
   * from there instead of yanking the strip back to where the timer thought it was.
   */
  const onUserMove = () => {
    setUserBusy(true);
    clearTimeout(resumeTimer.current);
    resumeTimer.current = setTimeout(() => setUserBusy(false), RESUME_AFTER_MS);
  };

  const onScroll = () => {
    clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => {
      const track = trackRef.current;
      const step = stepSize();
      if (!track || !step) return;
      const index = Math.round(Math.abs(track.scrollLeft) / step);
      setActiveIndex(Math.min(Math.max(index, 0), max));
    }, 120);
  };

  useEffect(() => () => {
    clearTimeout(resumeTimer.current);
    clearTimeout(settleTimer.current);
  }, []);

  if (vendors.length === 0) return null;

  const atStart = activeIndex === 0;
  const atEnd = activeIndex >= max;

  const arrowClass = 'w-10 h-10 rounded-full border-2 border-marine-teal/15 bg-white shadow-sm flex items-center justify-center text-marine-outline hover:border-marine-cyan hover:text-marine-primary disabled:opacity-30 transition-all';
  const leftArrow = (extra) => (
    <button
      type="button"
      aria-label={isAr ? 'تحريك التجار لليسار' : 'Move vendors left'}
      onClick={() => { onUserMove(); scroll('left'); }}
      disabled={isAr ? atEnd : atStart}
      className={`${arrowClass} ${extra}`}
    >
      <ChevronLeft size={18} />
    </button>
  );
  const rightArrow = (extra) => (
    <button
      type="button"
      aria-label={isAr ? 'تحريك التجار لليمين' : 'Move vendors right'}
      onClick={() => { onUserMove(); scroll('right'); }}
      disabled={isAr ? atStart : atEnd}
      className={`${arrowClass} ${extra}`}
    >
      <ChevronRight size={18} />
    </button>
  );

  return (
    <section ref={sectionRef} className="py-10 sm:py-14 bg-white" dir={isAr ? 'rtl' : 'ltr'}>
      <div className="max-w-7xl mx-auto px-4">
        {/* The title keeps its line; on a phone, where it and the controls do not fit side by
            side, "View all" and the arrows drop under it, at the end. */}
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3 mb-6 sm:mb-8">
          <div className="min-w-0">
            <p className="text-marine-primary text-sm font-semibold uppercase tracking-widest mb-1">
              {isAr ? 'التجار' : 'Vendors'}
            </p>
            <h2 className="text-2xl sm:text-4xl font-bold text-marine-ink">
              {isAr ? 'تسوق من التجار' : 'Shop by Vendor'}
            </h2>
          </div>
          <div className="flex items-center gap-3 shrink-0 ms-auto">
            <Link href="/vendors" className="whitespace-nowrap text-sm font-bold text-marine-outline hover:text-marine-primary transition-colors">
              {isAr ? 'عرض كل التجار' : 'View All Vendors'}
            </Link>
            {/* On a phone the arrows live up here: beside the track they sat on top of
                the first card's name, and the side padding they needed was a fifth of
                the width. The strip itself is swiped there anyway. */}
            {max > 0 && (
              <div className="flex sm:hidden items-center gap-2">
                {leftArrow('')}
                {rightArrow('')}
              </div>
            )}
          </div>
        </div>

        <div className={`relative ${max > 0 ? 'sm:px-14' : ''}`}>
          {max > 0 && leftArrow('hidden sm:flex absolute left-0 top-1/2 z-10 -translate-y-1/2')}

          <div
            ref={trackRef}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            onTouchStart={onUserMove}
            onPointerDown={onUserMove}
            onWheel={onUserMove}
            onScroll={onScroll}
            className="flex gap-3 sm:gap-5 overflow-x-auto scrollbar-hide snap-x snap-mandatory scroll-smooth -mx-4 px-4 scroll-px-4 sm:mx-0 sm:px-0 sm:scroll-px-0"
            style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}
          >
            {vendors.map(vendor => (
              // `flex` + the card's `h-full`: every card as tall as the tallest one, so a
              // city that wraps to a second line does not leave its card sticking out.
              <div key={vendor._id} className="flex flex-none snap-start">
                <VendorCard vendor={vendor} isAr={isAr} compact />
              </div>
            ))}
          </div>

          {max > 0 && rightArrow('hidden sm:flex absolute right-0 top-1/2 z-10 -translate-y-1/2')}
        </div>
      </div>
    </section>
  );
}
