'use client';

import { useState } from 'react';
import { Star } from 'lucide-react';

/**
 * Star rating — interactive when `onChange` is given, read-only otherwise.
 *
 * Rendered left-to-right even under RTL: a 5-star scale reads low-to-high in
 * both languages, and mirroring it makes 1 star look like 4.
 */
export default function StarRating({
    value = 0,
    onChange = null,
    size = 22,
    label,
    className = '',
}) {
    const [hover, setHover] = useState(0);
    const interactive = typeof onChange === 'function';
    const shown = hover || value;

    return (
        <div
            className={`inline-flex items-center gap-1 ${className}`}
            dir="ltr"
            role={interactive ? 'radiogroup' : 'img'}
            aria-label={label}
        >
            {[1, 2, 3, 4, 5].map((star) => {
                const filled = star <= shown;
                const Icon = (
                    <Star
                        size={size}
                        className={filled ? 'fill-amber-400 text-amber-400' : 'text-marine-muted'}
                    />
                );

                if (!interactive) return <span key={star}>{Icon}</span>;

                return (
                    <button
                        key={star}
                        type="button"
                        role="radio"
                        aria-checked={value === star}
                        aria-label={`${star}`}
                        onClick={() => onChange(star)}
                        onMouseEnter={() => setHover(star)}
                        onMouseLeave={() => setHover(0)}
                        onFocus={() => setHover(star)}
                        onBlur={() => setHover(0)}
                        className="transition-transform hover:scale-110 focus:outline-none focus:scale-110"
                    >
                        {Icon}
                    </button>
                );
            })}
        </div>
    );
}
