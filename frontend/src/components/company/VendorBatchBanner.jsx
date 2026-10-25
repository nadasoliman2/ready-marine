'use client';

import Link from '../LocaleLink';
import { Package, Printer, Users, ArrowUpRight, CheckCircle2 } from 'lucide-react';
import { getSubOrderStatusLabel, getSubOrderStatusColor } from '../../lib/orderStatus';

// Statuses that mean the main parcel — and so every order packed inside it — has left the store.
const RIDER_GONE = ['handed_to_courier', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered'];

/**
 * A combined company order, told to the vendor (feature 14): several customers' orders that
 * travel as ONE parcel to one office. The vendor confirms each order separately, packs each
 * person's items apart with their label, and ships the whole thing once — on the lead.
 *
 * `batch` is the server's `vendorBatchView`; `sub` is the parcel on screen.
 */
export default function VendorBatchBanner({ batch, sub, isAr }) {
    if (!batch) return null;
    const role = sub?.company_batch?.role;
    const lead = batch.lead;
    const isLead = role === 'lead';
    const members = (batch.members || []).filter((m) => !m.dropped);
    const allConfirmed = batch.confirmed_count >= batch.order_count;

    return (
        <div className="rounded-2xl border-2 border-indigo-300 dark:border-indigo-500/40 bg-indigo-50 dark:bg-indigo-500/10 p-5 space-y-4">
            <div>
                <p className="text-sm font-black text-indigo-900 dark:text-indigo-200 flex items-center gap-2">
                    <Package size={17} />
                    {isAr
                        ? `أوردر مجمّع — ${batch.order_count} عملاء من ${batch.company_name} بيستلموا من مكان واحد`
                        : `Combined order — ${batch.order_count} customers from ${batch.company_name}, received in one place`}
                </p>
                <p className="text-xs text-indigo-800/80 dark:text-indigo-300/80 mt-1">
                    {isAr ? `التوصيل على: ${batch.office?.name || ''}` : `Delivered to: ${batch.office?.name || ''}`}
                    {batch.office?.recipient_name ? ` — ${batch.office.recipient_name}` : ''}
                </p>
            </div>

            <ol className="space-y-1.5 text-sm text-indigo-950 dark:text-indigo-100 list-decimal ps-5 font-semibold">
                <li>{isAr ? 'أكّد منتجات كل أوردر لوحده — كل أوردر لعميل مختلف.' : 'Confirm each order separately — each belongs to a different customer.'}</li>
                <li>{isAr ? 'غلّف منتجات كل عميل لوحدها والزق عليها الليبل اللي باسمه.' : "Pack each customer's items on their own and stick their name label on them."}</li>
                <li>{isAr ? 'حط الكل في باكيدج واحد والزق عليه السمارت ليبل أو البوليصة — مرة واحدة، على الطرد الرئيسي.' : 'Put everything in ONE package with the Smart Label or waybill on it — once, on the main parcel.'}</li>
            </ol>

            <div className="flex flex-wrap items-center gap-2">
                <Link
                    href={`/dashboard/orders/batches/${batch._id}/labels`}
                    target="_blank"
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-black"
                >
                    <Printer size={14} />{isAr ? 'اطبع ليبلات العملاء' : 'Print customer labels'}
                </Link>
                {!isLead && lead && (
                    <Link
                        href={`/dashboard/orders/${lead.order_id}/parcels/${lead.sub_order_id}`}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white dark:bg-white/10 border border-indigo-200 dark:border-indigo-500/30 text-indigo-800 dark:text-indigo-200 text-xs font-black"
                    >
                        <ArrowUpRight size={14} />{isAr ? `الطرد الرئيسي #${lead.reference}` : `Main parcel #${lead.reference}`}
                    </Link>
                )}
                <span className={`inline-flex items-center gap-1 text-xs font-bold ${allConfirmed ? 'text-emerald-700 dark:text-emerald-400' : 'text-indigo-800 dark:text-indigo-300'}`}>
                    {allConfirmed && <CheckCircle2 size={13} />}
                    {isAr ? `${batch.confirmed_count} من ${batch.order_count} اتأكدوا` : `${batch.confirmed_count} of ${batch.order_count} confirmed`}
                </span>
            </div>

            {isLead && !batch.dispatched && (
                <p className="text-xs font-bold text-indigo-900 dark:text-indigo-200 bg-white/70 dark:bg-white/5 rounded-lg px-3 py-2">
                    {allConfirmed
                        ? (isAr ? 'كل الأوردرات اتأكدت — البوليصة أو السمارت ليبل من هنا بتغطي الطرد كله.' : 'Every order is confirmed — the waybill or Smart Label from here covers the whole parcel.')
                        : (isAr ? 'ده الطرد الرئيسي: البوليصة أو السمارت ليبل هتتعمل هنا بعد ما كل الأوردرات تتأكد.' : 'This is the main parcel: its waybill or Smart Label is made here once every order is confirmed.')}
                </p>
            )}
            {role === 'rider' && !['pending_review', 'needs_admin'].includes(sub.raw_status || sub.status) && (
                <p className="text-xs font-bold text-indigo-900 dark:text-indigo-200 bg-white/70 dark:bg-white/5 rounded-lg px-3 py-2">
                    {/* `status` is the main parcel's: once it has left, so has this order. */}
                    {RIDER_GONE.includes(sub.status)
                        ? (isAr
                            ? `الأوردر ده اتشحن جوه الطرد الرئيسي #${lead?.reference || ''} — مفيش عليك أي خطوة فيه، تسليمه هو تسليم الطرد الرئيسي.`
                            : `This order went out inside the main parcel #${lead?.reference || ''} — nothing to do on it; handing over the main parcel handed it over.`)
                        : (isAr
                            ? `الأوردر ده متأكد وبيتشحن جوه الطرد الرئيسي #${lead?.reference || ''} — كمّل الخطوات من هناك.`
                            : `This order is confirmed and ships inside the main parcel #${lead?.reference || ''} — continue from there.`)}
                </p>
            )}

            <ul className="divide-y divide-indigo-200/60 dark:divide-indigo-500/20 border-t border-indigo-200/60 dark:border-indigo-500/20">
                {members.map((m) => {
                    const current = String(m.sub_order_id) === String(sub?._id);
                    return (
                        <li key={m.sub_order_id} className="py-2 flex items-center justify-between gap-3">
                            <Link
                                href={`/dashboard/orders/${m.order_id}/parcels/${m.sub_order_id}`}
                                className={`min-w-0 text-xs ${current ? 'font-black text-indigo-950 dark:text-white' : 'font-bold text-indigo-800 dark:text-indigo-300 hover:underline'}`}
                            >
                                <span className="flex items-center gap-1.5 truncate">
                                    <Users size={12} className="shrink-0" />
                                    <span dir="ltr" className="font-mono">{m.reference}</span>
                                    <span className="truncate">· {m.display_name}</span>
                                    {m.is_lead && <span className="text-[10px] font-black uppercase text-indigo-600 dark:text-indigo-300">{isAr ? '· الرئيسي' : '· main'}</span>}
                                </span>
                            </Link>
                            <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-black ${getSubOrderStatusColor(m.status)}`}>
                                {getSubOrderStatusLabel(m.status, isAr)}
                            </span>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}
