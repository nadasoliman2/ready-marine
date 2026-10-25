'use client';

import { Children } from 'react';

/**
 * A home-page row of product cards. On a phone it slides sideways — two cards and the edge of
 * the next, so it reads as something to swipe — instead of stacking every product down the
 * page. From `sm` up it is the grid it always was (`gridClassName` sets its columns and gap).
 *
 * The section around it pads its content by 1rem (`px-4`); the row reaches past that to the
 * screen's edges so cards slide out of view rather than being cut at the padding.
 */
export default function ProductRail({ children, gridClassName = 'sm:grid-cols-3 lg:grid-cols-4 sm:gap-5' }) {
  return (
    <div
      className={`flex gap-3 overflow-x-auto snap-x snap-mandatory scroll-px-4 scrollbar-hide -mx-4 px-4 pb-1
        sm:grid sm:overflow-visible sm:snap-none sm:mx-0 sm:px-0 sm:pb-0 ${gridClassName}`}
    >
      {Children.map(children, (child) => (
        <div className="flex shrink-0 w-[44%] snap-start sm:w-auto [&>*]:w-full">{child}</div>
      ))}
    </div>
  );
}
