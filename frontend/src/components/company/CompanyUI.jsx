'use client';

import { useEffect } from 'react';
import { Loader2, X, AlertCircle, CheckCircle2 } from 'lucide-react';
import Overlay from '../Overlay';

/**
 * Furniture shared by the company portal and the admin "Companies" section.
 * Built on the finance UI kit so money and tables look the same everywhere in
 * the dashboards.
 */
export {
    CARD, INPUT, LABEL, Money, StatCard, Spinner, EmptyState, TableWrap, Th, Td,
} from '../dashboard/finance/FinanceUI';

const BTN_BASE = 'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed';

export const BTN = {
    primary: `${BTN_BASE} bg-marine-cyan text-white hover:bg-marine-cyan-dark shadow-sm shadow-red-500/20`,
    secondary: `${BTN_BASE} bg-zinc-100 dark:bg-white/5 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-white/10`,
    ghost: `${BTN_BASE} text-zinc-500 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-50 dark:hover:bg-white/5`,
    danger: `${BTN_BASE} bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-500/20`,
    success: `${BTN_BASE} bg-emerald-600 text-white hover:bg-emerald-700`,
};

export function Button({ variant = 'primary', loading = false, icon: Icon, children, className = '', disabled = false, type = 'button', ...props }) {
    return (
        <button type={type} className={`${BTN[variant] || BTN.primary} ${className}`} disabled={loading || disabled} {...props}>
            {loading ? <Loader2 size={16} className="animate-spin" /> : Icon ? <Icon size={16} /> : null}
            {children}
        </button>
    );
}

export function PageHeader({ title, subtitle, actions }) {
    return (
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-6">
            <div>
                <h1 className="text-2xl font-black text-zinc-900 dark:text-white">{title}</h1>
                {subtitle && <p className="text-sm text-zinc-500 mt-1">{subtitle}</p>}
            </div>
            {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
    );
}

export function Field({ label, hint, children, className = '' }) {
    return (
        <div className={className}>
            {label && <label className="block text-[11px] font-bold text-zinc-500 uppercase tracking-wide mb-1.5">{label}</label>}
            {children}
            {hint && <p className="text-[11px] text-zinc-400 mt-1">{hint}</p>}
        </div>
    );
}

export function Notice({ tone = 'error', children, onClose }) {
    if (!children) return null;
    const tones = {
        error: 'bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/20 text-red-700 dark:text-red-300',
        success: 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/20 text-emerald-700 dark:text-emerald-300',
        warn: 'bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/20 text-amber-800 dark:text-amber-300',
        info: 'bg-sky-50 dark:bg-sky-500/10 border-sky-200 dark:border-sky-500/20 text-sky-800 dark:text-sky-300',
    };
    const Icon = tone === 'success' ? CheckCircle2 : AlertCircle;
    return (
        <div className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-sm font-semibold mb-4 ${tones[tone] || tones.error}`}>
            <Icon size={18} className="mt-0.5 shrink-0" />
            <div className="flex-1">{children}</div>
            {onClose && (
                <button type="button" onClick={onClose} className="opacity-60 hover:opacity-100" aria-label="Close">
                    <X size={16} />
                </button>
            )}
        </div>
    );
}

/** A centered dialog. Escape and the backdrop close it. */
export function Modal({ open, onClose, title, children, footer, wide = false }) {
    useEffect(() => {
        if (!open) return undefined;
        const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, onClose]);

    if (!open) return null;
    return (
        <Overlay className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center p-0 sm:p-4">
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
            <div className={`relative w-full ${wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'} max-h-[92vh] flex flex-col bg-white dark:bg-[#14171A] rounded-t-2xl sm:rounded-2xl shadow-2xl border border-zinc-100 dark:border-white/10`}>
                <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100 dark:border-white/5">
                    <h2 className="text-base font-black text-zinc-900 dark:text-white">{title}</h2>
                    <button type="button" onClick={onClose} className="p-1 text-zinc-400 hover:text-zinc-900 dark:hover:text-white" aria-label="Close">
                        <X size={18} />
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
                {footer && <div className="px-5 py-4 border-t border-zinc-100 dark:border-white/5 flex flex-wrap justify-end gap-2">{footer}</div>}
            </div>
        </Overlay>
    );
}

export function Pill({ className = '', children }) {
    return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold whitespace-nowrap ${className}`}>{children}</span>;
}

export function CompanyStatusPill({ status, isAr }) {
    if (status === 'ended') return <Pill className="bg-zinc-200 text-zinc-700 dark:bg-white/10 dark:text-zinc-300">{isAr ? 'انتهى التعاقد' : 'Contract ended'}</Pill>;
    return status === 'suspended'
        ? <Pill className="bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400">{isAr ? 'موقوفة' : 'Suspended'}</Pill>
        : <Pill className="bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">{isAr ? 'نشطة' : 'Active'}</Pill>;
}
