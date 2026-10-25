'use client';

import { useCallback } from 'react';
import { useRouter } from './navigation';

/**
 * Makes a whole table row (or card) open its record, not just the name inside it.
 *
 * The name is a small target and nobody aims for it: people click the row. So the row itself
 * goes where the name would have gone.
 *
 * Anything in the row that already does something of its own keeps doing it — a link, a
 * button, a checkbox, a dropdown. Those are left alone rather than wrapped in
 * stopPropagation one by one, because the next button added to a row would be forgotten.
 * Mark anything else that must not open the record with `data-no-row-link`.
 *
 *   const rowLink = useRowLink();
 *   <tr {...rowLink(`/admin/dashboard/companies/${c._id}`)} className="... cursor-pointer">
 *
 * Pass a function instead of a path when the record opens in place (a modal, a side panel).
 */

const OWN_ACTION = 'a, button, input, select, textarea, label, summary, [role="button"], [role="menuitem"], [role="dialog"], [data-no-row-link]';

export default function useRowLink() {
    const router = useRouter();

    return useCallback((target) => {
        if (!target) return {};

        const open = (event, newTab) => {
            if (typeof target === 'function') target(event);
            else if (newTab) window.open(target, '_blank', 'noopener');
            else router.push(target);
        };

        // A click that bubbled up from a modal or menu the row opened is not a click on the
        // row: React delivers it here even though it is drawn elsewhere on the page.
        const isOwnAction = (event) => !event.currentTarget.contains(event.target)
            || Boolean(event.target.closest?.(OWN_ACTION));

        return {
            onClick: (event) => {
                if (event.defaultPrevented || isOwnAction(event)) return;
                // Dragging across a row to copy an order number ends in a click too.
                if (window.getSelection?.()?.toString()) return;
                open(event, event.ctrlKey || event.metaKey);
            },
            // Middle click opens a new tab, as it does on any link.
            onAuxClick: (event) => {
                if (event.button !== 1 || typeof target === 'function' || isOwnAction(event)) return;
                open(event, true);
            },
            onKeyDown: (event) => {
                if (event.key !== 'Enter' || event.target !== event.currentTarget) return;
                open(event, event.ctrlKey || event.metaKey);
            },
            tabIndex: 0,
        };
    }, [router]);
}
