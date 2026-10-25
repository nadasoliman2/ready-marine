'use client';

import { useState } from 'react';
import { Package, ChevronDown, Wallet } from 'lucide-react';

/**
 * The two disclosures that make a split order unsurprising, shown BEFORE payment.
 *
 * Splitting an order is only disruptive when it is a surprise. Once the customer has read
 * "3 parcels, 3 couriers, these amounts" and then paid, the split is something they agreed
 * to rather than something that happened to them — and "why is the courier asking me for a
 * different number?" stops being a support call.
 *
 * Renders nothing for a single-parcel basket, which is most orders. Nothing changes for
 * them at all.
 *
 * @param {Object}  delivery   the `delivery` block from the checkout preview
 * @param {boolean} isCOD      show the per-courier amounts only when paying cash
 */
export default function DeliverySplitSummary({ delivery, isCOD, currency, isAr }) {
    // Collapsed by default: the customer who does not care sees one shipping number, and
    // the one who wonders "why 150?" gets the answer without contacting anybody.
    const [showBreakdown, setShowBreakdown] = useState(false);

    if (!delivery?.is_split) return null;

    const parcels = delivery.parcels || [];
    const shippingTotal = parcels.reduce((sum, p) => sum + Number(p.shipping || 0), 0);
    const money = (n) => `${currency} ${Number(n || 0).toFixed(2)}`;
    const parcelName = (p) =>
        p.fulfillment_location ? `${p.vendor_name} · ${p.fulfillment_location}` : p.vendor_name;

    return (
        <div className="mt-4 space-y-3">
            {/* The sentence that makes everything after it unsurprising. */}
            <div className="flex items-start gap-2.5 rounded-xl bg-blue-50 border border-blue-200 p-3">
                <Package size={16} className="text-blue-600 mt-0.5 shrink-0" />
                <div className="text-xs leading-relaxed">
                    <p className="font-bold text-blue-900">
                        {isAr
                            ? `طلبك هيوصل في ${delivery.parcel_count} شحنات منفصلة`
                            : `Your order arrives as ${delivery.parcel_count} separate parcels`}
                    </p>
                    <p className="text-blue-700 mt-0.5">
                        {isAr
                            ? 'كل شحنة من متجر مختلف، بمندوب مختلف ويوم مختلف.'
                            : 'Each comes from a different store, with its own courier and its own day.'}
                    </p>
                </div>
            </div>

            {/* Why the shipping line says what it says. */}
            <div className="rounded-xl border border-marine-teal/15 overflow-hidden">
                <button
                    type="button"
                    onClick={() => setShowBreakdown((v) => !v)}
                    className="w-full flex items-center justify-between px-3 py-2.5 text-xs font-semibold text-marine-muted hover:bg-marine-canvas transition"
                    aria-expanded={showBreakdown}
                >
                    <span>{isAr ? 'تفاصيل الشحن' : 'Shipping breakdown'}</span>
                    <span className="flex items-center gap-1.5">
                        <span className="font-bold text-marine-ink">{money(shippingTotal)}</span>
                        <ChevronDown
                            size={14}
                            className={`transition-transform ${showBreakdown ? 'rotate-180' : ''}`}
                        />
                    </span>
                </button>

                {showBreakdown && (
                    <ul className="border-t border-marine-teal/15 divide-y divide-zinc-100">
                        {parcels.map((p, i) => (
                            <li key={i} className="flex items-center justify-between gap-3 px-3 py-2 text-[11px]">
                                <span className="text-marine-muted truncate">{parcelName(p)}</span>
                                <span className="font-semibold text-marine-ink shrink-0">{money(p.shipping)}</span>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            {/* Cash only: the amounts, adding up to the order total in front of them. */}
            {isCOD && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 overflow-hidden">
                    <div className="flex items-center gap-2 px-3 py-2.5 border-b border-amber-200">
                        <Wallet size={14} className="text-amber-700" />
                        <p className="text-xs font-bold text-amber-900">
                            {isAr ? 'المطلوب من كل مندوب' : 'What each courier will collect'}
                        </p>
                    </div>
                    <ul className="divide-y divide-amber-100">
                        {parcels.map((p, i) => (
                            <li key={i} className="flex items-center justify-between gap-3 px-3 py-2 text-[11px]">
                                <span className="text-amber-900 truncate">{parcelName(p)}</span>
                                <span className="font-bold text-amber-900 shrink-0">
                                    {money(p.amount_due_on_delivery)}
                                </span>
                            </li>
                        ))}
                    </ul>
                    <div className="flex items-center justify-between px-3 py-2 bg-amber-100/60 text-xs font-bold text-amber-900">
                        <span>{isAr ? 'الإجمالي' : 'Total'}</span>
                        <span>{money(delivery.cod_total)}</span>
                    </div>
                </div>
            )}
        </div>
    );
}
