'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from '../../../../../../components/LocaleLink';
import { Loader2, Printer, ArrowLeft, ArrowRight, Package } from 'lucide-react';
import { vendorApi } from '../../../../../../lib/api';
import { useApp } from '../../../../../../context/AppContext';

/**
 * Packing labels for a combined company order (feature 14): one label per person, to stick
 * on the bag or box holding THEIR items before everything goes into the one parcel. At the
 * office the receptionist opens the parcel and hands each bag to the name on it — without
 * these labels that is exactly where orders get mixed up.
 *
 * Rendered without the dashboard around it (see the vendor layout) so it prints clean.
 */
export default function BatchLabelsPage() {
    const { batchId } = useParams();
    const { language } = useApp();
    const isAr = language === 'ar';
    const [batch, setBatch] = useState(null);
    const [error, setError] = useState('');

    useEffect(() => {
        vendorApi.getCompanyBatch(batchId)
            .then((res) => setBatch(res.batch))
            .catch((err) => setError(err.message || 'Could not load the combined order'));
    }, [batchId]);

    if (error) return <p className="p-8 text-red-600 font-bold">{error}</p>;
    if (!batch) return <div className="p-16 flex justify-center"><Loader2 className="animate-spin text-marine-primary" size={28} /></div>;

    const members = batch.members.filter((m) => !m.dropped);
    const Back = isAr ? ArrowRight : ArrowLeft;
    const backHref = batch.lead ? `/dashboard/orders/${batch.lead.order_id}/parcels/${batch.lead.sub_order_id}` : '/dashboard/orders';

    return (
        <div className="max-w-4xl mx-auto p-6 print:p-0">
            <div className="print:hidden mb-6 space-y-4">
                <Link href={backHref} className="inline-flex items-center gap-1.5 text-sm font-bold text-zinc-500 hover:text-zinc-900">
                    <Back size={16} />{isAr ? 'رجوع للطرد' : 'Back to the parcel'}
                </Link>
                <div className="rounded-2xl border-2 border-indigo-200 bg-indigo-50 p-5">
                    <p className="font-black text-indigo-900 text-lg flex items-center gap-2"><Package size={20} />{isAr ? `ليبلات ${members.length} عملاء — طرد مجمّع واحد` : `Labels for ${members.length} customers — one combined parcel`}</p>
                    <ol className="mt-3 space-y-1.5 text-sm text-indigo-900 list-decimal ps-5">
                        <li>{isAr ? 'اطبع الصفحة دي وقص الليبلات.' : 'Print this page and cut the labels apart.'}</li>
                        <li>{isAr ? 'غلّف منتجات كل عميل لوحدها، والزق عليها الليبل اللي باسمه.' : "Pack each customer's items on their own and stick their label on it."}</li>
                        <li>{isAr ? 'حط كل الأكياس في باكيدج واحد، والزق عليه السمارت ليبل أو البوليصة.' : 'Put every bag into ONE package and stick the Smart Label or the waybill on it.'}</li>
                    </ol>
                </div>
                <button onClick={() => window.print()} className="inline-flex items-center gap-2 bg-marine-cyan hover:bg-marine-cyan-dark text-white font-bold px-5 py-3 rounded-xl">
                    <Printer size={18} />{isAr ? 'اطبع الليبلات' : 'Print the labels'}
                </button>
            </div>

            {/* Only the labels reach the printer — not the banners or buttons around the page. */}
            <style>{`@media print {
                body * { visibility: hidden; }
                .batch-labels, .batch-labels * { visibility: visible; }
                .batch-labels { position: absolute; inset: 0 auto auto 0; width: 100%; }
            }`}</style>
            <div className="batch-labels grid grid-cols-1 sm:grid-cols-2 print:grid-cols-2 gap-4">
                {members.map((m, i) => (
                    <div key={m.sub_order_id} className="border-2 border-dashed border-zinc-400 rounded-xl p-4 break-inside-avoid" style={{ pageBreakInside: 'avoid' }}>
                        <div className="flex items-start justify-between gap-2">
                            <p className="text-xs font-bold text-zinc-500">{isAr ? `كيس ${i + 1} من ${members.length}` : `Bag ${i + 1} of ${members.length}`}</p>
                            <p className="text-xs font-mono text-zinc-600" dir="ltr">{m.reference}</p>
                        </div>
                        <p className="mt-2 text-2xl font-black text-zinc-900 leading-tight">{m.display_name || '—'}</p>
                        <p className="text-sm text-zinc-600 mt-1">{batch.company_name} — {batch.office?.name}</p>
                        <ul className="mt-3 border-t border-zinc-200 pt-2 space-y-1">
                            {m.items.filter((it) => it.vendor_status !== 'declined').map((it) => (
                                <li key={it._id} className="text-sm text-zinc-800 flex justify-between gap-2">
                                    <span>{it.title}{it.variant ? ` (${it.variant})` : ''}</span>
                                    <span className="font-bold shrink-0" dir="ltr">× {it.quantity}</span>
                                </li>
                            ))}
                        </ul>
                        <p className="mt-3 text-[11px] text-zinc-500">
                            {isAr ? 'جزء من طرد مجمّع — بيتسلّم لصاحبه في مكان الاستلام.' : 'Part of a combined parcel — handed to this person at the delivery address.'}
                        </p>
                    </div>
                ))}
            </div>
        </div>
    );
}
