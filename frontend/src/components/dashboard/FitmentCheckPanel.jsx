'use client';

import { useCallback, useEffect, useState } from 'react';
import { CarFront } from 'lucide-react';
import { adminFitmentApi } from '../../lib/api';
import { L } from '../../lib/catalog';
import FitmentFindings from './FitmentFindings';

/**
 * The fitment check on the admin's product page: what the title or description names that the
 * fitment does not, with the fix one press away. Shows nothing when they agree, or when the
 * admin has already said this fitment is right.
 */
export default function FitmentCheckPanel({ productId, language, onChanged }) {
    const [check, setCheck] = useState(null);

    const load = useCallback(() => {
        adminFitmentApi.get(productId).then(setCheck).catch(() => setCheck(null));
    }, [productId]);

    useEffect(() => { load(); }, [load]);

    const shown = (check?.findings || []).filter((f) => f.severity !== 'info' || f.type === 'generation_only');
    if (!check || check.dismissed || !shown.length) return null;

    return (
        <section className="mt-6 rounded-2xl border border-amber-200 dark:border-amber-500/20 bg-amber-50/40 dark:bg-amber-500/[0.04] p-6 shadow-sm">
            <h2 className="text-lg font-black text-zinc-900 dark:text-white flex items-center gap-2 mb-1">
                <CarFront size={17} className="text-amber-500" />
                {L(language, 'Fitment check', 'مراجعة التوافق')}
            </h2>
            <p className="text-xs text-zinc-500 mb-4">
                {L(language, 'What the title or description says about the cars, against the fitment.', 'اللي العنوان أو الوصف بيقوله عن العربيات، مقارنة بالتوافق المسجل.')}
            </p>
            <FitmentFindings
                key={check.signature}
                productId={productId}
                findings={shown}
                language={language}
                onChanged={async () => { load(); await onChanged?.(); }}
            />
        </section>
    );
}
