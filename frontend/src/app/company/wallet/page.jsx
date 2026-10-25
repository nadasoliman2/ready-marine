'use client';

import { useCallback, useEffect, useState } from 'react';
import { Wallet, RefreshCw } from 'lucide-react';
import { useApp } from '../../../context/AppContext';
import { companyPortalApi } from '../../../lib/api';
import { formatMoney, formatDateTime, errorText, hasWallet } from '../../../lib/companyLocalization';
import { CARD, INPUT, PageHeader, StatCard, Field, Button, Notice, Spinner, TableWrap, Th, Td } from '../../../components/company/CompanyUI';
import { usePortalTerms } from '../../../components/company/OrgTermsContext';

export default function CompanyWalletPage() {
    const { language } = useApp();
    const isAr = language === 'ar';
    const ot = usePortalTerms(isAr);
    const [data, setData] = useState(null);
    const [page, setPage] = useState(1);
    const [amount, setAmount] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const load = useCallback(async () => {
        try { setData(await companyPortalApi.getWallet(page)); }
        catch (err) { setError(errorText(err, isAr)); }
    }, [page, isAr]);
    useEffect(() => { load(); }, [load]);
    useEffect(() => {
        const query = new URLSearchParams(window.location.search);
        const topupId = query.get('topupId');
        const companyId = query.get('companyId');
        if (!topupId || !companyId) return;
        // The gateway sends a declined card to the "failed" return URL; the server
        // still checks with the provider, so a late success is credited either way.
        const gatewayFailed = query.get('topup') === 'failed';
        let active = true;
        setBusy(true);
        companyPortalApi.confirmWalletTopup(topupId, companyId).then(async (result) => {
            if (!active) return;
            if (result.status !== 'paid' && gatewayFailed) {
                setError(isAr ? 'عملية الدفع مانجحتش. جرّب تاني.' : 'The payment did not go through. Please try again.');
                window.history.replaceState(null, '', '/company/wallet');
            } else {
                setNotice(result.status === 'paid'
                    ? (isAr ? `الدفع اتأكد والرصيد اتضاف لمحفظة ${ot.the}.` : `Payment verified and the ${ot.one} wallet credited.`)
                    : (isAr ? 'الدفع لسه مستني التأكيد. حدّث الصفحة بعد شوية.' : 'Payment is still awaiting confirmation. Refresh shortly.'));
            }
            if (result.status === 'paid') window.history.replaceState(null, '', '/company/wallet');
            await load();
        }).catch((err) => { if (active) setError(errorText(err, isAr)); })
            .finally(() => { if (active) setBusy(false); });
        return () => { active = false; };
    }, [isAr, load]);

    const topup = async (event) => {
        event.preventDefault();
        setError('');
        setBusy(true);
        try {
            const result = await companyPortalApi.topupWallet(Number(amount));
            if (!result.topup?.payment_url) throw new Error(isAr ? 'رابط الدفع مش متاح دلوقتي.' : 'Payment link is unavailable.');
            window.location.assign(result.topup.payment_url);
        } catch (err) { setError(errorText(err, isAr)); setBusy(false); }
    };
    const names = {
        topup: isAr ? 'شحن أونلاين' : 'Online top-up', purchase: isAr ? 'خصم أوردر' : 'Order payment',
        refund: isAr ? 'استرداد' : 'Refund', reversal: isAr ? 'إرجاع خصم' : 'Reversal', settlement: isAr ? 'تسوية ختامية' : 'Closing refund',
        invoice: isAr ? 'اتنقل للفاتورة' : 'Moved to the invoice',
    };
    const onWallet = hasWallet(data?.company.billing_mode);
    return <div>
        <PageHeader title={isAr ? `محفظة ${ot.the}` : `${ot.One} wallet`} subtitle={data?.company.name}
            actions={<Button variant="secondary" icon={RefreshCw} onClick={load}>{isAr ? 'تحديث' : 'Refresh'}</Button>} />
        {error && <Notice onClose={() => setError('')}>{error}</Notice>}
        {notice && <Notice tone="success" onClose={() => setNotice('')}>{notice}</Notice>}
        {!data ? <Spinner /> : <>
            {!onWallet ? <>
            {/* On an invoice now: the wallet it used to pay from is shown, not topped up. */}
            <div className="grid sm:grid-cols-3 gap-4 mb-5">
                <StatCard icon={Wallet} label={isAr ? 'رصيد المحفظة' : 'Wallet balance'} value={formatMoney(data.balance, isAr)} />
            </div>
            <Notice tone="info">{isAr
                ? `${ot.the} ${ot.v('بتتحاسب', 'بيتحاسب')} بفاتورة شهرية دلوقتي. اللي في المحفظة — رصيد ليكم أو مبلغ عليكم — بيتسوّى في الفاتورة الجاية، ومرتجعات الأوردرات اللي اتدفعت منها بترجع لها.`
                : `This ${ot.one} pays by monthly invoice now. What is in the wallet — a balance in your favour or an amount owed — is settled on the next invoice, and returns of orders paid from it come back to it.`}</Notice>
            </> : data.company.billing_mode === 'credit_wallet' ? <>
            <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-5">
                <StatCard icon={Wallet} label={isAr ? 'رصيد المحفظة' : 'Wallet balance'} value={formatMoney(data.balance, isAr)}
                    sub={data.owed > 0 ? (isAr ? `عليكم ${formatMoney(data.owed, true)}` : `You owe ${formatMoney(data.owed, false)}`) : undefined} />
                <StatCard label={isAr ? 'الحد الائتماني' : 'Credit limit'} value={formatMoney(data.credit_line, isAr)} />
                <StatCard label={isAr ? 'متاح للصرف' : 'Available to spend'} value={formatMoney(data.credit_limit, isAr)} />
                <StatCard label={isAr ? 'متاح للتوزيع' : 'Available to allocate'} value={formatMoney(data.available_to_allocate, isAr)}
                    sub={isAr ? `المخصص لـ${ot.members} والدعوات ${formatMoney(data.allocated, true)}` : `${formatMoney(data.allocated, false)} allocated to ${ot.members} and invitations`} />
            </div>
            <p className="text-sm text-zinc-500 mb-5">{isAr ? `كل أوردر بيتخصم من المحفظة، والرصيد ممكن ينزل بالسالب لحد الحد الائتماني. مفيش فواتير ولا ميعاد سداد: اشحن المحفظة في أي وقت عشان تسدد اللي عليكم. لما اللي عليكم يوصل للحد الائتماني، الطلب بيقف لحد ما تشحنوا. الإلغاء والمرتجع بيرجعوا لمحفظة ${ot.the}.` : `Every order is deducted from this wallet, and the balance may go below zero down to the credit limit. No invoices and no due date: top up at any time to pay back what you owe. Once what you owe reaches the credit limit, ordering stops until you top up. Cancellations and returns go back to the ${ot.one} wallet.`}</p>
            </> : <>
            <div className="grid sm:grid-cols-3 gap-4 mb-5">
                <StatCard icon={Wallet} label={isAr ? 'الرصيد / إجمالي الحد الائتماني' : 'Balance / total credit limit'} value={formatMoney(data.balance, isAr)} />
                <StatCard label={isAr ? `المخصص المتبقي لـ${ot.members} والدعوات` : `Remaining ${ot.member} and invitation limits`} value={formatMoney(data.allocated, isAr)} />
                <StatCard label={isAr ? 'متاح للتوزيع' : 'Available to allocate'} value={formatMoney(data.available_to_allocate, isAr)} />
            </div>
            <p className="text-sm text-zinc-500 mb-5">{isAr ? `كل أوردر لازم الرصيد يغطيه بالكامل وبيتخصم من المحفظة. حدود ${ot.members} شهرية، لكن رصيد المحفظة مش بيتجدد أول الشهر. الإلغاء والمرتجع بيرجعوا لمحفظة ${ot.the}.` : `Every order must be fully covered and is deducted from this wallet. ${ot.Member} limits are monthly; wallet funds do not reset each month. Cancellations and returns refund the ${ot.one} wallet.`}</p>
            {data.owed > 0 && <Notice>{isAr ? `على ${ot.the} ${formatMoney(data.owed, true)} — فرق شحن اتخصم والرصيد مكانش كفاية. أول شحن للمحفظة بيسدده، ومفيش طلبات جديدة لحد ما الرصيد يبقى موجب.` : `The ${ot.one} owes ${formatMoney(data.owed, false)} — a shipping difference charged when the balance was short. The next top-up pays it first; no new orders until the balance is positive.`}</Notice>}
            </>}
            {data.shortfall > 0 && <Notice>{isAr ? `اشحن ${formatMoney(data.shortfall, true)} أو قلّل الحدود لتغطية كل المبالغ المخصصة. الطلبات بتفضل مقيدة بالرصيد الفعلي.` : `Top up ${formatMoney(data.shortfall, false)} or reduce limits to cover all allocations. Orders remain limited by the actual balance.`}</Notice>}
            {onWallet && (data.company.status !== 'ended' || data.owed > 0) && <form onSubmit={topup} className={`${CARD} p-5 mb-5 flex flex-col sm:flex-row gap-4 sm:items-end`}>
                <Field label={isAr ? 'مبلغ الشحن (ج.م)' : 'Top-up amount (EGP)'}>
                    <input className={INPUT} type="number" min="0.01" step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} dir="ltr" />
                </Field>
                <Button type="submit" loading={busy}>{isAr ? 'اشحن بالدفع الأونلاين' : 'Top up online'}</Button>
            </form>}
            <div className={CARD}><TableWrap><table className="w-full">
                <thead><tr><Th align="start">{isAr ? 'التاريخ' : 'Date'}</Th><Th align="start">{isAr ? 'الحركة' : 'Transaction'}</Th><Th align="start">{isAr ? 'المبلغ' : 'Amount'}</Th><Th align="start">{isAr ? 'الرصيد بعدها' : 'Balance after'}</Th></tr></thead>
                <tbody>{data.transactions.map((item) => <tr key={item._id} className="border-t border-zinc-100 dark:border-white/5">
                    <Td align="start">{formatDateTime(item.created_at, isAr)}</Td><Td align="start">{names[item.kind] || item.kind}</Td>
                    <Td align="start"><span dir="ltr" className={item.amount > 0 ? 'text-emerald-600' : ''}>{item.amount > 0 ? '+' : ''}{formatMoney(item.amount, isAr)}</span></Td>
                    <Td align="start">{formatMoney(item.balance_after, isAr)}</Td>
                </tr>)}</tbody>
            </table></TableWrap>
            {!data.transactions.length && <p className="p-8 text-center text-zinc-500">{isAr ? 'مفيش حركات لسه.' : 'No transactions yet.'}</p>}
            <div className="p-4 flex items-center justify-between gap-3">
                <Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>{isAr ? 'السابق' : 'Previous'}</Button>
                <span>{page} / {data.pagination.pages}</span>
                <Button variant="secondary" disabled={page >= data.pagination.pages} onClick={() => setPage(page + 1)}>{isAr ? 'التالي' : 'Next'}</Button>
            </div></div>
        </>}
    </div>;
}
