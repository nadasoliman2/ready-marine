'use client';

import { useState } from 'react';
import { Building2, Car, CheckCircle2, AlertCircle, User, Truck, Zap, Star, ChevronDown, HelpCircle, Clock, Users } from 'lucide-react';
import { orgTerms } from '../../lib/orgTerms';

/**
 * The company-account part of checkout (feature 14): who the order is for, and
 * how the total splits between the company and the person ordering.
 *
 * Every figure comes from the server's preview (`info`), never from arithmetic
 * here — the same rule the wallet panel follows — so what the customer reads is
 * exactly what the server will enforce at placement.
 */

export const companyReasonText = (reason, info, isAr) => {
    const ot = orgTerms(info?.company?.org_type, isAr);
    const renews = info?.renews_on
        ? new Date(info.renews_on).toLocaleDateString(isAr ? 'ar-EG' : 'en-US', { day: 'numeric', month: 'long' })
        : '';
    switch (reason) {
        case 'LIMIT_USED_UP': return isAr ? `الليميت بتاعك خلص الشهر ده — بيتجدد ${renews}. تقدر تطلب بطريقة دفع تانية من حسابك.` : `Your limit for this month is used up — it renews on ${renews}. You can pay another way from your own account.`;
        case 'LIMIT_NOT_ENOUGH': {
            const left = Number(info?.remaining_limit ?? info?.remaining ?? 0).toFixed(2);
            return isAr
                ? `الأوردر أكبر من اللي فاضل في الليميت (${left}). ${ot.the} ${ot.v('بتدفع', 'بيدفع')} الأوردر كله أو ${ot.v('مابتدفعش', 'مابيدفعش')} — اطلبه بطريقة دفع تانية من حسابك، أو قلّل السلة.`
                : `This order is more than what is left on your limit (${left}). The ${ot.one} pays a whole order or none of it — pay another way from your own account, or trim the basket.`;
        }
        case 'EMPLOYEE_DEACTIVATED': return isAr ? `مدير حساب ${ot.the} وقّف طلبك على ${ot.v('حسابها', 'حسابه')}. تقدر تطلب بطريقة دفع تانية من حسابك.` : `Your ${ot.one}'s manager has paused your ordering on its account. You can pay another way from your own account.`;
        case 'NOT_IN_COMPANY': return isAr ? `مش تابع ${ot.toThe} ${ot.v('دي', 'ده')}.` : `You are not part of that ${ot.one} account.`;
        case 'COMPANY_WALLET_INSUFFICIENT': return isAr ? `رصيد محفظة ${ot.the} لازم يغطي الأوردر بالكامل. اطلب من مدير ${ot.the} يشحن المحفظة.` : `The ${ot.one} wallet must cover the whole order. Ask your manager to top up.`;
        case 'COMPANY_ALLOCATION_EXCEEDED': return isAr ? `الرصيد مخصص لحدود ${ot.members}. اشحن المحفظة أو عدّل الحدود.` : `This balance is allocated to ${ot.members}. Top up or adjust limits.`;
        case 'COMPANY_CAP_REACHED': return isAr ? `سقف ${ot.the} الشهري مايكفيش الأوردر ده.` : `The ${ot.one}'s monthly cap does not cover this order.`;
        case 'COMPANY_SUSPENDED': return isAr ? `الطلب على حساب ${ot.the} موقوف مؤقتاً.` : `Ordering on the ${ot.one} account is temporarily paused.`;
        case 'INSTANT_MODE_OFF': return isAr ? `${ot.your} ${ot.v('مفعّلة', 'مفعّل')} التوصيل المجمّع على ${ot.theBranch} بس.` : `Your ${ot.one} allows only consolidated delivery to the ${ot.branch}.`;
        case 'CONSOLIDATE_MODE_OFF': return isAr ? `${ot.your} مش ${ot.v('مفعّلة', 'مفعّل')} التجميع على ${ot.theBranch} — اختار فوري.` : `Your ${ot.one} does not consolidate to the ${ot.branch} — choose instant.`;
        case 'OFFICE_REQUIRED': return isAr ? `اختار ${ot.theBranch} اللي هيوصل عليه الأوردر.` : `Choose the ${ot.branch} to deliver to.`;
        case 'CAR_REQUIRED': return isAr ? `اختار عربية ${ot.the} اللي الأوردر ده ليها.` : `Choose which ${ot.one} car this order is for.`;
        case 'NOT_EMPLOYEE': return isAr ? `مالكش ليميت على حساب ${ot.the}.` : `You have no limit on the ${ot.one} account.`;
        default: return isAr ? `الطلب على حساب ${ot.the} مش متاح دلوقتي.` : `Ordering on the ${ot.one} account is not available right now.`;
    }
};

const Money = ({ value, currency }) => (
    <span dir="ltr" className="tabular-nums">{currency} {Number(value || 0).toFixed(2)}</span>
);

export default function CompanyCheckoutPanel({
    info,
    selection,
    onChange,
    isAr,
    currency,
}) {
    const ot = orgTerms(info?.company?.org_type, isAr);
    const companies = info?.companies || [];
    if (!info?.eligible && companies.length < 2) return null;
    const roles = info.roles || {};
    const isCar = selection.beneficiary === 'car';

    return (
        <div className="mt-4 space-y-4">
            {/* Someone in several companies chooses which one pays. Each has its own limit. */}
            {companies.length > 1 && (
                <div>
                    <p className="text-xs font-semibold text-marine-outline uppercase mb-2">{isAr ? `على حساب أنهي ${ot.one}؟` : `Which ${ot.one} pays?`}</p>
                    <div className="grid sm:grid-cols-2 gap-2">
                        {companies.map((c) => {
                            const active = String(c._id) === String(info.company?._id);
                            return (
                                <button
                                    key={c._id}
                                    type="button"
                                    onClick={() => onChange({ company_id: c._id })}
                                    className={`p-3 rounded-xl border-2 flex items-center gap-3 text-start ${active ? 'border-marine-cyan bg-red-50/30' : 'border-marine-teal/15 hover:border-marine-teal/25'}`}
                                >
                                    <Building2 size={18} className="text-marine-primary shrink-0" />
                                    <span className="text-sm font-bold text-marine-ink">{c.name}</span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}
            {!info.eligible ? (
                <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3">
                    <AlertCircle size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
                    <p className="text-sm font-semibold text-amber-900">{companyReasonText(info.reason || 'NOT_EMPLOYEE', info, isAr)}</p>
                </div>
            ) : (
            <>
            <CompanyDeliveryModes info={info} selection={selection} onChange={onChange} isAr={isAr} currency={currency} />
            {roles.manager && (
                <div>
                    <p className="text-xs font-semibold text-marine-outline uppercase mb-2">{isAr ? 'لمين الأوردر ده؟' : 'Who is this order for?'}</p>
                    <div className="grid sm:grid-cols-2 gap-2">
                        {roles.employee && (
                            <button
                                type="button"
                                onClick={() => onChange({ beneficiary: 'employee', car_id: '' })}
                                className={`p-3 rounded-xl border-2 flex items-center gap-3 text-start ${!isCar ? 'border-marine-cyan bg-red-50/30' : 'border-marine-teal/15 hover:border-marine-teal/25'}`}
                            >
                                <User size={18} className="text-marine-primary shrink-0" />
                                <span className="text-sm font-bold text-marine-ink">{isAr ? 'ليا — من الليميت بتاعي' : 'Me — from my limit'}</span>
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={() => onChange({ beneficiary: 'car' })}
                            className={`p-3 rounded-xl border-2 flex items-center gap-3 text-start ${isCar ? 'border-marine-cyan bg-red-50/30' : 'border-marine-teal/15 hover:border-marine-teal/25'}`}
                        >
                            <Car size={18} className="text-marine-primary shrink-0" />
                            <span className="text-sm font-bold text-marine-ink">{isAr ? `عربية من عربيات ${ot.the}` : `A ${ot.one} car`}</span>
                        </button>
                    </div>
                    {isCar && (
                        info.cars?.length ? (
                            <select
                                value={selection.car_id || ''}
                                onChange={(e) => onChange({ car_id: e.target.value })}
                                className="mt-2 w-full px-4 py-3 rounded-lg border border-marine-teal/15 focus:border-marine-cyan outline-none"
                            >
                                <option value="">{isAr ? '— اختار العربية —' : '— choose the car —'}</option>
                                {info.cars.map((c) => <option key={c._id} value={c._id}>{c.label}</option>)}
                            </select>
                        ) : (
                            <p className="mt-2 text-xs text-amber-700">{isAr ? `مفيش عربيات مسجلة. سجلها من لوحة ${ot.the}.` : `No cars are registered. Add them in the ${ot.one} portal.`}</p>
                        )
                    )}
                </div>
            )}

            {!info.available ? (
                <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3">
                    <AlertCircle size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
                    <p className="text-sm font-semibold text-amber-900">{companyReasonText(info.reason, info, isAr)}</p>
                </div>
            ) : (
                <div className="p-4 rounded-xl border bg-emerald-50 border-emerald-200">
                    <div className="flex items-start gap-3">
                        <CheckCircle2 size={16} className="text-emerald-600 flex-shrink-0 mt-0.5" />
                        <div className="flex-1 space-y-1 text-sm">
                            <p className="font-bold text-marine-ink flex items-center gap-1.5">
                                <Building2 size={14} className="text-marine-primary" />
                                {isAr ? `${info.company?.name} هتغطي ` : `${info.company?.name} covers `}
                                <Money value={info.company_amount} currency={currency} />
                            </p>
                            {!isCar && info.remaining_limit !== null && info.remaining_limit !== undefined && (
                                <p className="text-marine-muted">
                                    {isAr ? 'فاضل في الليميت قبل الأوردر: ' : 'Left on your limit before this order: '}
                                    <Money value={info.remaining_limit} currency={currency} />
                                </p>
                            )}
                        </div>
                    </div>
                </div>
            )}
            </>
            )}
        </div>
    );
}

/** Company offices as delivery destinations, shown above the personal addresses. */
export function CompanyOfficePicker({ offices = [], selectedId, onSelect, companyName, orgType = 'company', isAr, officeOnly = false }) {
    const ot = orgTerms(orgType, isAr);
    if (!offices.length) return null;
    return (
        <div className="mb-6">
            <p className="text-xs font-semibold text-marine-outline uppercase mb-2 flex items-center gap-1.5">
                <Building2 size={13} className="text-marine-primary" />
                {isAr ? `التوصيل على ${ot.branch} ${companyName || `${ot.the}`}` : `Deliver to a ${companyName || 'company'} ${ot.branch}`}
            </p>
            <div className="grid sm:grid-cols-2 gap-4">
                {offices.map((office) => {
                    const selected = String(selectedId) === String(office._id);
                    return (
                        <div
                            key={office._id}
                            onClick={() => onSelect(office._id)}
                            className={`relative p-4 rounded-xl border-2 cursor-pointer transition-all ${selected ? 'border-marine-cyan bg-red-50/30' : 'border-marine-teal/15 hover:border-marine-teal/25'}`}
                        >
                            {selected && <div className="absolute top-3 end-3 text-marine-primary"><CheckCircle2 size={20} className="fill-marine-cyan text-white" /></div>}
                            <p className="font-bold text-marine-ink mb-1 flex items-center gap-1.5"><Building2 size={14} />{office.name}</p>
                            <p className="text-marine-outline text-xs leading-relaxed line-clamp-2">{office.full_address}</p>
                            <p className="text-marine-outline text-[11px] mt-1">{isAr ? 'بيستلم: ' : 'Received by: '}{office.recipient_name}</p>
                        </div>
                    );
                })}
            </div>
            <p className="text-xs text-marine-outline mt-3">
                {officeOnly
                    ? (isAr ? `التجميع بيوصل على ${ot.branch} ${ot.the} بس. عايزه على البيت؟ اختار "فوري" في طريقة التوصيل تحت.` : `Consolidated orders go to a ${ot.branch} only. Want it at home? Choose "Instant" under delivery below.`)
                    : (isAr ? 'أو اختار عنوانك تحت:' : 'Or pick your own address below:')}
            </p>
        </div>
    );
}

/* ------------------------------------------------------------------ */
/* Delivery mode (phase 3)                                             */
/* ------------------------------------------------------------------ */

const fmtDeadline = (value, isAr) => {
    if (!value) return '';
    return new Date(value).toLocaleString(isAr ? 'ar-EG' : 'en-US', { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' });
};

/** One delivery option in `CompanyDeliveryModes`. */
const DeliveryModeCard = ({ active, allowed, onSelect, notEnabledNote, icon: Icon, title, children, badge }) => (
    <button
        type="button"
        disabled={!allowed}
        onClick={onSelect}
        className={`relative p-4 rounded-xl border-2 text-start transition-all disabled:opacity-50 disabled:cursor-not-allowed ${active ? 'border-marine-cyan bg-red-50/30' : 'border-marine-teal/15 hover:border-marine-teal/25 bg-white'}`}
    >
        {active && <CheckCircle2 size={18} className="absolute top-3 end-3 fill-marine-cyan text-white" />}
        <p className="font-bold text-marine-ink flex items-center gap-2"><Icon size={17} className="text-marine-primary" />{title}</p>
        {badge && <p className="mt-1.5 inline-flex items-center gap-1 text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5"><Star size={11} className="fill-emerald-600 text-emerald-600" />{badge}</p>}
        <div className="mt-2 space-y-1 text-xs text-marine-muted">{children}</div>
        {!allowed && <p className="mt-2 text-[11px] font-bold text-marine-outline">{notEnabledNote}</p>}
    </button>
);

/**
 * The two delivery cards, side by side (stacked on a phone), with the numbers that
 * decide between them. The one promise the person must take away: they never pay more
 * than instant, and whatever the batch saves comes back to them.
 */
export function CompanyDeliveryModes({ info, selection, onChange, isAr, currency }) {
    const ot = orgTerms(info?.company?.org_type, isAr);
    const [showHow, setShowHow] = useState(false);
    const [perParcel, setPerParcel] = useState(false);
    const modes = info?.modes || { instant: true, consolidate: false };
    if (!modes.consolidate && !modes.instant) return null;

    const mode = selection.delivery_mode || (modes.consolidate ? 'consolidate' : 'instant');
    const consolidation = mode === 'consolidate' ? info.consolidation : null;
    const parcels = consolidation?.parcels || [];
    const shipNow = new Set((selection.ship_now_vendor_ids || []).map(String));
    const held = parcels.filter((p) => !shipNow.has(String(p.vendor_id)));
    const fullShipping = parcels.reduce((sum, p) => sum + Number(p.standalone_shipping || 0), 0);
    const saveUpTo = held.reduce((sum, p) => sum + Number(p.save_up_to || 0), 0);
    const minShipping = parcels.reduce((sum, p) => sum + (shipNow.has(String(p.vendor_id)) ? Number(p.standalone_shipping || 0) : Number(p.share_if_full || 0)), 0);
    const heldShipping = held.reduce((sum, p) => sum + Number(p.standalone_shipping || 0), 0);
    const office = (info.offices || []).find((o) => String(o._id) === String(info.office_id || info.default_office_id));

    const toggleShipNow = (vendorId) => {
        const next = new Set(shipNow);
        if (next.has(String(vendorId))) next.delete(String(vendorId)); else next.add(String(vendorId));
        onChange({ ship_now_vendor_ids: [...next] });
    };

    const notEnabledNote = isAr ? `${ot.your} مش ${ot.v('مفعّلاه', 'مفعّله')}` : `Not enabled by your ${ot.one}`;
    const cardProps = (value) => ({
        active: mode === value,
        allowed: modes[value],
        notEnabledNote,
        onSelect: () => onChange({ delivery_mode: value }),
    });

    return (
        <div>
            <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-marine-outline uppercase">{isAr ? 'طريقة التوصيل' : 'How should it arrive?'}</p>
                {modes.consolidate && (
                    <button type="button" onClick={() => setShowHow((v) => !v)} className="text-xs font-bold text-marine-primary inline-flex items-center gap-1">
                        <HelpCircle size={13} />{isAr ? 'ازاي؟' : 'How?'}
                    </button>
                )}
            </div>

            {showHow && (
                <div className="mb-3 p-3 rounded-xl bg-marine-canvas border border-marine-teal/15 text-xs text-marine-muted leading-relaxed space-y-1">
                    <p className="font-bold text-marine-ink">{isAr ? `التجميع على ${ot.theBranch} بيوفّر إزاي؟` : 'How does consolidating save?'}</p>
                    <p>{isAr
                        ? `أوردرك بيستنى زمايلك اللي طالبين من نفس المورد، وبيتشحنوا كلهم طرد واحد على ${ot.theBranch}، وشحن الطرد بيتقسم عليكم.`
                        : `Your order waits for colleagues ordering from the same store; they all ship as one parcel to the ${ot.branch}, and its shipping is split between you.`}</p>
                    <p>{isAr
                        ? 'مثال: الشحن لوحدك 60 ج. لو 3 طلبوا من نفس المورد والطرد كله بـ 60، نصيب كل واحد 20 ج ويرجعلك 40.'
                        : 'Example: shipping alone is 60. If 3 order from the same store and the parcel costs 60, each pays 20 and 40 comes back to you.'}</p>
                    <p className="font-bold">{isAr
                        ? 'عمرك ما هتدفع أكتر من الفوري، واللي بيتوفر بيرجعلك أول ما الدفعة تتقفل.'
                        : 'You never pay more than instant, and whatever is saved comes back as soon as the batch closes.'}</p>
                </div>
            )}

            <div className="grid sm:grid-cols-2 gap-2">
                <DeliveryModeCard
                    {...cardProps('consolidate')}
                    icon={Truck}
                    title={isAr ? `تجميع على ${ot.theBranch}` : `Consolidate to ${ot.branch}`}
                    badge={mode === 'consolidate' && saveUpTo > 0 ? (isAr ? `وفّر لحد ${currency} ${saveUpTo.toFixed(2)}` : `Save up to ${currency} ${saveUpTo.toFixed(2)}`) : (isAr ? 'أوفر' : 'Cheaper')}
                >
                    {mode === 'consolidate' && parcels.length > 0 && (
                        <p>{isAr ? 'الشحن: ' : 'Shipping: '}<span dir="ltr" className="font-bold tabular-nums">{currency} {minShipping.toFixed(2)} – {fullShipping.toFixed(2)}</span></p>
                    )}
                    <p>{isAr ? 'المكان: ' : 'Where: '}<span className="font-bold">{office?.name || (isAr ? `${ot.branch} ${ot.the}` : `the ${ot.branch}`)}</span></p>
                    <p>{isAr ? 'بيستنى زمايلك من نفس المورد، وبعدين بيتشحن معاهم.' : 'Waits for colleagues ordering from the same store, then ships with them.'}</p>
                </DeliveryModeCard>
                <DeliveryModeCard {...cardProps('instant')} icon={Zap} title={isAr ? 'فوري' : 'Instant'}>
                    {parcels.length > 0 && (
                        <p>{isAr ? 'الشحن: ' : 'Shipping: '}<span dir="ltr" className="font-bold tabular-nums">{currency} {fullShipping.toFixed(2)}</span></p>
                    )}
                    <p>{isAr ? `المكان: البيت أو ${ot.theBranch}، إنت تختار.` : `Where: home or the ${ot.branch}, your choice.`}</p>
                    <p>{isAr ? 'بيتحرك على طول بشحن كامل.' : 'Ships right away at full shipping.'}</p>
                </DeliveryModeCard>
            </div>

            {mode === 'consolidate' && (
                <div className="mt-3 space-y-2">
                    {!consolidation ? (
                        <p className="text-xs text-marine-outline flex items-center gap-1.5"><Clock size={12} className="animate-pulse" />{isAr ? 'بنشوف حال الدفعات…' : 'Checking the batches…'}</p>
                    ) : (
                        <>
                            {parcels.map((p) => (
                                <ParcelBatchLine key={`${p.vendor_id}-${p.fulfillment_location}`} parcel={p} rushed={shipNow.has(String(p.vendor_id))} isAr={isAr} currency={currency} />
                            ))}
                            {heldShipping > 0 && info?.available && (
                                <p className="text-xs font-bold text-marine-ink bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                                    {isAr
                                        ? `هنحجز ${currency} ${heldShipping.toFixed(2)} شحن من الليميت دلوقتي، واللي هيتوفر هيرجعلك أول ما الدفعة تتقفل.`
                                        : `We hold ${currency} ${heldShipping.toFixed(2)} of shipping from your limit now; whatever is saved comes back as soon as the batch closes.`}
                                </p>
                            )}
                            {parcels.length > 0 && (
                                <div>
                                    <button type="button" onClick={() => setPerParcel((v) => !v)} className="text-xs font-bold text-marine-outline hover:text-marine-ink inline-flex items-center gap-1">
                                        <ChevronDown size={13} className={`transition-transform ${perParcel ? 'rotate-180' : ''}`} />
                                        {isAr ? 'تخصيص لكل طرد' : 'Customize per parcel'}
                                    </button>
                                    {perParcel && (
                                        <div className="mt-2 space-y-1.5">
                                            {parcels.map((p) => (
                                                <label key={`rush-${p.vendor_id}`} className="flex items-center gap-2 text-xs text-marine-muted cursor-pointer">
                                                    <input type="checkbox" checked={shipNow.has(String(p.vendor_id))} onChange={() => toggleShipNow(p.vendor_id)} className="accent-marine-cyan" />
                                                    {isAr ? `ابعت طرد ${p.vendor_name || 'المورد'} فوري (شحن كامل)` : `Ship the ${p.vendor_name || 'store'} parcel now (full shipping)`}
                                                </label>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                        </>
                    )}
                </div>
            )}
        </div>
    );
}

/** One store's batch: how many are waiting (never who), and when it moves at the latest. */
function ParcelBatchLine({ parcel, rushed, isAr, currency }) {
    const p = parcel;
    const store = p.vendor_name || (isAr ? 'المورد ده' : 'this store');
    let text;
    if (rushed) {
        text = isAr ? `${store}: هيتبعت فوري بشحن كامل ${currency} ${Number(p.standalone_shipping).toFixed(2)}.` : `${store}: ships now at full shipping, ${currency} ${Number(p.standalone_shipping).toFixed(2)}.`;
    } else if (p.will_close_now) {
        text = isAr
            ? `${store}: ${p.waiting} من زمايلك طالبين من المورد ده. لو انضميت الدفعة تكمل وتتحرك فوراً، ونصيبك حوالي ${currency} ${Number(p.share_if_full).toFixed(2)}.`
            : `${store}: ${p.waiting} colleague(s) ordered from this store. Joining completes the batch — it ships right away and your share is about ${currency} ${Number(p.share_if_full).toFixed(2)}.`;
    } else if (p.opens_new) {
        text = isAr
            ? `${store}: هتبقى أول واحد — الدفعة هتتحرك لما يكمل ${p.target} أو ${fmtDeadline(p.deadline_at, true)} بالكتير.`
            : `${store}: you are the first — the batch ships when it reaches ${p.target} or by ${fmtDeadline(p.deadline_at, false)} at the latest.`;
    } else {
        text = isAr
            ? `${store}: ${p.waiting} من زمايلك مستنيين (من ${p.target}). لو كملت نصيبك حوالي ${currency} ${Number(p.share_if_full).toFixed(2)}، ولو ماكملتش هتتحرك ${fmtDeadline(p.deadline_at, true)} بالكتير.`
            : `${store}: ${p.waiting} of ${p.target} waiting. If it fills, your share is about ${currency} ${Number(p.share_if_full).toFixed(2)}; if not, it ships by ${fmtDeadline(p.deadline_at, false)} at the latest.`;
    }
    return (
        <p className="text-xs text-marine-muted flex items-start gap-2 leading-relaxed">
            <Users size={13} className="text-marine-primary mt-0.5 shrink-0" />
            <span>{text}</span>
        </p>
    );
}
