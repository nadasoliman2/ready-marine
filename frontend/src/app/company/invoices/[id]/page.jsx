'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from '../../../../components/LocaleLink';
import { Printer, Upload, ArrowLeft, ArrowRight } from 'lucide-react';
import { useApp } from '../../../../context/AppContext';
import { companyPortalApi } from '../../../../lib/api';
import { errorText } from '../../../../lib/companyLocalization';
import { CARD, Button, Notice, Spinner } from '../../../../components/company/CompanyUI';
import InvoiceDocument, { InvoicePrintStyle } from '../../../../components/company/InvoiceDocument';
import { PaymentList, PaymentForm, openReceipt } from '../../../../components/company/InvoicePayments';

/**
 * One invoice: the printable statement, the transfers against it, and "we transferred it"
 * with the receipt (Ready Marine confirms it before it counts).
 */
export default function CompanyInvoicePage() {
    const { id } = useParams();
    const { language } = useApp();
    const isAr = language === 'ar';
    const [invoice, setInvoice] = useState(null);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const [formOpen, setFormOpen] = useState(false);
    const Back = isAr ? ArrowRight : ArrowLeft;

    const load = useCallback(async () => {
        try {
            setInvoice((await companyPortalApi.getInvoice(id)).invoice);
        } catch (err) {
            setError(errorText(err, isAr));
        }
    }, [id, isAr]);

    useEffect(() => { load(); }, [load]);

    if (!invoice) return error ? <Notice>{error}</Notice> : <Spinner />;
    const canPay = invoice.balance > 0;

    return (
        <div className="max-w-4xl">
            <InvoicePrintStyle />
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <Link href="/company/invoices" className="inline-flex items-center gap-1.5 text-sm font-bold text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
                    <Back size={16} /> {isAr ? 'كل الفواتير' : 'All invoices'}
                </Link>
                <div className="flex gap-2">
                    {canPay && <Button icon={Upload} onClick={() => setFormOpen(true)}>{isAr ? 'حوّلنا — ارفع الإيصال' : 'We transferred — upload receipt'}</Button>}
                    <Button variant="secondary" icon={Printer} onClick={() => window.print()}>{isAr ? 'اطبع / احفظ PDF' : 'Print / save PDF'}</Button>
                </div>
            </div>
            {error && <Notice onClose={() => setError('')}>{error}</Notice>}
            {message && <Notice tone="success" onClose={() => setMessage('')}>{message}</Notice>}

            <InvoiceDocument invoice={invoice} isAr={isAr} />

            <div className={`${CARD} p-5 mt-6`}>
                <h2 className="font-black text-zinc-900 dark:text-white mb-3">{isAr ? 'التحويلات' : 'Transfers'}</h2>
                <PaymentList
                    payments={invoice.payments}
                    isAr={isAr}
                    onOpenReceipt={(p) => openReceipt(() => companyPortalApi.getReceipt(p._id)).catch((err) => setError(errorText(err, isAr)))}
                />
            </div>

            {formOpen && (
                <PaymentForm
                    open
                    onClose={() => setFormOpen(false)}
                    balance={invoice.balance}
                    isAr={isAr}
                    requireFile
                    title={isAr ? `إيصال تحويل — ${invoice.number}` : `Transfer receipt — ${invoice.number}`}
                    submitLabel={isAr ? 'ابعت للتأكيد' : 'Send for confirmation'}
                    onSubmit={async (form, file) => {
                        await companyPortalApi.submitReceipt(invoice._id, form, file);
                        setMessage(isAr ? 'الإيصال وصل Ready Marine — هيتحسب أول ما يتأكد.' : 'Ready Marine has the receipt — it counts once confirmed.');
                        await load();
                    }}
                />
            )}
        </div>
    );
}
