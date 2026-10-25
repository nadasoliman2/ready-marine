'use client';

import { useState } from 'react';
import { FileText, Check, X } from 'lucide-react';
import { Button, Modal, Field, INPUT, Notice, Pill } from './CompanyUI';
import {
    formatMoney, formatDate, paymentStatusLabel, paymentStatusClass, errorText,
} from '../../lib/companyLocalization';

/**
 * The transfers recorded against an invoice (feature 14, phase 4), and the form that adds
 * one. The company's managers upload a receipt that waits for Ready Marine; the admin records a
 * transfer directly, or confirms / rejects an uploaded one.
 */

/** Open a receipt returned as a blob in a new tab. */
export const openReceipt = async (loadBlob) => {
    const blob = await loadBlob();
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
};

export function PaymentList({ payments = [], isAr, onOpenReceipt, onConfirm = null, onReject = null, busyId = '' }) {
    if (!payments.length) {
        return <p className="text-sm text-zinc-500">{isAr ? 'لسه مفيش تحويلات متسجلة على الفاتورة دي.' : 'No transfers recorded on this invoice yet.'}</p>;
    }
    return (
        <ul className="divide-y divide-zinc-100 dark:divide-white/5">
            {payments.map((p) => (
                <li key={p._id} className="py-3 flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                        <p className="font-bold text-zinc-900 dark:text-white tabular-nums" dir="ltr">{formatMoney(p.amount, isAr)}</p>
                        {p.kind === 'credit' ? (
                            <p className="text-xs text-zinc-500">
                                {isAr ? 'اتخصم من رصيدكم (مرتجعات وتوفير بعد نهاية التعاقد) يوم ' : 'Taken from your credit (returns and savings after the contract ended) on '}{formatDate(p.paid_on, isAr)}
                                {p.reference ? ` · ${p.reference}` : ''}
                            </p>
                        ) : (
                            <p className="text-xs text-zinc-500">
                                {isAr ? 'تحويل يوم ' : 'Transferred '}{formatDate(p.paid_on, isAr)}
                                {p.reference ? ` · ${isAr ? 'مرجع' : 'Ref'} ${p.reference}` : ''}
                                {' · '}{p.submitted_by?.kind === 'admin' ? (isAr ? 'سجّلها Ready Marine' : 'Recorded by Ready Marine') : (isAr ? `رفعها ${p.submitted_by?.label || 'المدير'}` : `Uploaded by ${p.submitted_by?.label || 'a manager'}`)}
                            </p>
                        )}
                        {p.note && p.kind !== 'credit' && <p className="text-xs text-zinc-500 mt-0.5">{p.note}</p>}
                        {p.status === 'rejected' && p.rejected_reason && (
                            <p className="text-xs text-red-600 dark:text-red-400 mt-1">{isAr ? 'سبب الرفض: ' : 'Rejected: '}{p.rejected_reason}</p>
                        )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        <Pill className={paymentStatusClass(p.status)}>{paymentStatusLabel(p.status, isAr)}</Pill>
                        {p.has_receipt && (
                            <Button variant="secondary" icon={FileText} onClick={() => onOpenReceipt(p)}>{isAr ? 'الإيصال' : 'Receipt'}</Button>
                        )}
                        {p.status === 'pending' && onConfirm && (
                            <Button variant="success" icon={Check} loading={busyId === `c-${p._id}`} onClick={() => onConfirm(p)}>{isAr ? 'تأكيد' : 'Confirm'}</Button>
                        )}
                        {p.status === 'pending' && onReject && (
                            <Button variant="danger" icon={X} loading={busyId === `r-${p._id}`} onClick={() => onReject(p)}>{isAr ? 'رفض' : 'Reject'}</Button>
                        )}
                    </div>
                </li>
            ))}
        </ul>
    );
}

/**
 * Amount, transfer date, bank reference, note, receipt. `requireFile` for the company (a
 * claim needs its proof); optional for the admin, who is looking at the bank statement.
 */
export function PaymentForm({ open, onClose, onSubmit, balance, isAr, title, requireFile = false, submitLabel }) {
    const today = new Date().toISOString().slice(0, 10);
    const [form, setForm] = useState({ amount: balance ? String(balance) : '', paid_on: today, reference: '', note: '' });
    const [file, setFile] = useState(null);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

    const submit = async () => {
        setError('');
        if (requireFile && !file) {
            setError(isAr ? 'ارفع صورة إيصال التحويل.' : 'Attach the transfer receipt.');
            return;
        }
        setSaving(true);
        try {
            await onSubmit(form, file);
            onClose();
        } catch (err) {
            setError(errorText(err, isAr));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal
            open={open}
            onClose={onClose}
            title={title}
            footer={(
                <>
                    <Button variant="secondary" onClick={onClose}>{isAr ? 'إلغاء' : 'Cancel'}</Button>
                    <Button loading={saving} onClick={submit}>{submitLabel}</Button>
                </>
            )}
        >
            {error && <Notice onClose={() => setError('')}>{error}</Notice>}
            <div className="grid sm:grid-cols-2 gap-4">
                <Field label={isAr ? 'المبلغ المحوّل' : 'Amount transferred'} hint={balance ? `${isAr ? 'المتبقي' : 'Left'}: ${formatMoney(balance, isAr)}` : ''}>
                    <input type="number" min="0" step="0.01" value={form.amount} onChange={set('amount')} className={`${INPUT} w-full`} dir="ltr" />
                </Field>
                <Field label={isAr ? 'تاريخ التحويل' : 'Transfer date'}>
                    <input type="date" max={today} value={form.paid_on} onChange={set('paid_on')} className={`${INPUT} w-full`} dir="ltr" />
                </Field>
                <Field label={isAr ? 'رقم مرجع التحويل (اختياري)' : 'Bank reference (optional)'}>
                    <input value={form.reference} onChange={set('reference')} className={`${INPUT} w-full`} dir="ltr" />
                </Field>
                <Field label={isAr ? 'ملاحظة (اختياري)' : 'Note (optional)'}>
                    <input value={form.note} onChange={set('note')} className={`${INPUT} w-full`} />
                </Field>
            </div>
            <Field
                className="mt-4"
                label={requireFile ? (isAr ? 'صورة الإيصال' : 'Receipt') : (isAr ? 'صورة الإيصال (اختياري)' : 'Receipt (optional)')}
                hint={isAr ? 'صورة أو PDF، لحد 8 ميجا.' : 'An image or a PDF, up to 8 MB.'}
            >
                <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,application/pdf"
                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                    className="block w-full text-sm text-zinc-600 dark:text-zinc-300 file:me-3 file:rounded-lg file:border-0 file:bg-zinc-100 dark:file:bg-white/10 file:px-3 file:py-2 file:text-sm file:font-bold"
                />
            </Field>
        </Modal>
    );
}
