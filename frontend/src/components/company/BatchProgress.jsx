'use client';

import { useEffect, useState } from 'react';
import { Users, Clock } from 'lucide-react';

/**
 * Where a waiting company batch stands: "2 of 3" as a bar, and how long until it ships
 * anyway. Numbers only — colleagues are never named to an employee.
 */

export const timeLeft = (deadline, isAr, now = Date.now()) => {
    const ms = new Date(deadline).getTime() - now;
    if (!Number.isFinite(ms)) return '';
    if (ms <= 0) return isAr ? 'بيتحرك دلوقتي' : 'shipping now';
    const minutes = Math.round(ms / 60000);
    const days = Math.floor(minutes / 1440);
    const hours = Math.floor((minutes % 1440) / 60);
    const mins = minutes % 60;
    if (isAr) {
        if (days > 0) return `باقي ${days} يوم${hours ? ` و${hours} ساعة` : ''}`;
        if (hours > 0) return `باقي ${hours} ساعة${mins ? ` و${mins} دقيقة` : ''}`;
        return `باقي ${Math.max(1, mins)} دقيقة`;
    }
    if (days > 0) return `${days}d ${hours}h left`;
    if (hours > 0) return `${hours}h ${mins}m left`;
    return `${Math.max(1, mins)}m left`;
};

export const formatDeadline = (deadline, isAr) => (deadline
    ? new Date(deadline).toLocaleString(isAr ? 'ar-EG' : 'en-US', { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' })
    : '');

export default function BatchProgress({ waiting = 0, target = 3, deadline, isAr, dark = true }) {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const t = setInterval(() => setNow(Date.now()), 60000);
        return () => clearInterval(t);
    }, []);
    const pct = Math.min(100, Math.round((Number(waiting) / Math.max(1, Number(target))) * 100));
    return (
        <div>
            <div className="flex items-center justify-between gap-3 text-xs">
                <span className={`font-bold flex items-center gap-1.5 ${dark ? 'text-white' : 'text-zinc-900 dark:text-white'}`}>
                    <Users size={13} className="text-marine-primary" />
                    {isAr ? `${waiting} من ${target} في الدفعة` : `${waiting} of ${target} in the batch`}
                </span>
                {deadline && (
                    <span className={`flex items-center gap-1 ${dark ? 'text-zinc-400' : 'text-zinc-500'}`}>
                        <Clock size={12} />{timeLeft(deadline, isAr, now)}
                    </span>
                )}
            </div>
            <div className={`mt-2 h-2 rounded-full overflow-hidden ${dark ? 'bg-white/10' : 'bg-zinc-100 dark:bg-white/10'}`}>
                <div className="h-full bg-marine-cyan rounded-full transition-all" style={{ width: `${pct}%` }} />
            </div>
            {deadline && (
                <p className={`mt-1.5 text-[11px] ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                    {isAr
                        ? `بيتحرك لما يكمل ${target}، أو ${formatDeadline(deadline, true)} بالكتير.`
                        : `Ships when it reaches ${target}, or ${formatDeadline(deadline, false)} at the latest.`}
                </p>
            )}
        </div>
    );
}
