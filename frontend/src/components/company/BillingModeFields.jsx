'use client';

import { INPUT, Field, Notice } from './CompanyUI';
import { formatMoney, hasWallet } from '../../lib/companyLocalization';

/** The figure the admin edits: the line under a credit wallet, the month's cap on an invoice. */
const savedCap = (company) => (company.billing_mode === 'credit_wallet' ? company.credit_line : company.monthly_cap);

/** What an edit form starts from. */
export const billingFormFrom = (company) => ({
    billing_mode: company.billing_mode || 'monthly',
    monthly_cap: savedCap(company),
    payment_terms_days: company.payment_terms_days,
    overdue_grace_days: company.overdue_grace_days,
});

/** What the form sends. An empty figure goes as typed, so the server refuses it instead of saving zero. */
export const billingPatch = (form) => ({
    billing_mode: form.billing_mode,
    ...(form.billing_mode === 'wallet' ? {} : { monthly_cap: form.monthly_cap === '' ? '' : Number(form.monthly_cap) }),
    ...(form.billing_mode === 'monthly' ? {
        payment_terms_days: Number(form.payment_terms_days),
        overdue_grace_days: Number(form.overdue_grace_days),
    } : {}),
});

/** What moving the account to `mode` does to the money already on it. */
function changeNote({ company, mode, isAr, t }) {
    const from = company.billing_mode || 'monthly';
    const balance = Number(company.wallet_balance || 0);
    const money = formatMoney(Math.abs(balance), isAr);
    if (mode === 'monthly') {
        return [
            isAr ? 'الأوردرات الجديدة هتتحاسب بفاتورة شهرية. الأوردرات اللي اتدفعت من المحفظة بتكمل عليها: أي مرتجع ليها بيرجع للمحفظة ويتخصم من الفاتورة الجاية.'
                : 'New orders go on a monthly invoice. Orders paid from the wallet stay on it: a return goes back to the wallet and comes off the next invoice.',
            balance > 0 && (isAr ? `رصيد المحفظة الحالي ${money} هيتخصم من أول فاتورة.` : `The ${money} in the wallet now comes off the first invoice.`),
            balance < 0 && (isAr ? `على ${t.the} ${money} في المحفظة — هتتضاف على أول فاتورة.` : `The ${t.one} owes ${money} on the wallet — it is added to the first invoice.`),
        ];
    }
    if (hasWallet(from)) {
        return mode === 'credit_wallet'
            ? [isAr ? 'نفس المحفظة ونفس الرصيد، وبقى تحتها حد ائتماني.' : 'The same wallet and balance, now with a credit limit under it.']
            : [
                isAr ? 'نفس المحفظة، من غير حد ائتماني: كل أوردر لازم الرصيد يغطيه.' : 'The same wallet, without a credit limit: the balance must cover every order.',
                balance < 0 && (isAr ? `اللي على ${t.the} (${money}) لازم يتسدد بشحن المحفظة قبل أي أوردر جديد.` : `What the ${t.one} owes (${money}) has to be topped up before any new order.`),
            ];
    }
    return [
        isAr ? `الأوردرات الجديدة هتتدفع من المحفظة${mode === 'credit_wallet' ? ' لحد الحد الائتماني' : ''}. رصيد المحفظة دلوقتي ${formatMoney(balance, isAr)} — مدير ${t.the} يشحنها أونلاين.`
            : `New orders are paid from the wallet${mode === 'credit_wallet' ? ', down to the credit limit' : ''}. Its balance is ${formatMoney(balance, isAr)} now — the manager tops it up online.`,
        isAr ? 'الأوردرات اللي اتطلبت على الفاتورة قبل كده هتطلع في فاتورتها عادي ولازم تتدفع، ولو اتأخرت الطلب بيتوقف.'
            : 'Orders already placed on the invoice are still invoiced and owed; if that invoice runs late, ordering pauses.',
    ];
}

/**
 * How an existing account pays, in the admin's edit forms: the mode, the figure that goes
 * with it and — while the mode is being changed — what the change does to the money
 * already on the account. `company` is the account as saved.
 */
export default function BillingModeFields({ company, form, setForm, isAr, t }) {
    const saved = company.billing_mode || 'monthly';
    const changed = form.billing_mode !== saved;
    const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });
    // The cap of an invoice and the line of a credit wallet are different figures: a new
    // mode starts with it empty, and going back restores the saved one.
    const setMode = (e) => setForm({ ...form, billing_mode: e.target.value, monthly_cap: e.target.value === saved ? savedCap(company) : '' });
    const number = (key) => <input type="number" min="0" dir="ltr" className={`${INPUT} w-full`} value={form[key] ?? ''} onChange={set(key)} />;

    return (
        <div className="space-y-3">
            <Field label={isAr ? 'طريقة الحساب' : 'Billing method'}>
                <select className={`${INPUT} w-full`} value={form.billing_mode} onChange={setMode} disabled={company.status === 'ended'}>
                    <option value="monthly">{isAr ? 'فاتورة شهرية — تحويل بنكي' : 'Monthly invoice — bank transfer'}</option>
                    <option value="wallet">{isAr ? 'محفظة مسبقة الدفع' : 'Prepaid wallet'}</option>
                    <option value="credit_wallet">{isAr ? 'محفظة بحد ائتماني' : 'Wallet with a credit limit'}</option>
                </select>
            </Field>

            {form.billing_mode === 'wallet' ? (
                <p className="text-sm text-zinc-500">{isAr ? 'محفظة مسبقة الدفع — الحد الإجمالي بيساوي الرصيد المتاح.' : 'Prepaid wallet — total credit equals the available balance.'}</p>
            ) : form.billing_mode === 'credit_wallet' ? (
                <Field label={isAr ? 'الحد الائتماني (ج.م)' : 'Credit limit (EGP)'} hint={isAr ? `أقصى مبلغ رصيد محفظة ${t.the} ينزله تحت الصفر. بعده مفيش طلبات لحد ما المحفظة تتشحن.` : `How far below zero the ${t.one} wallet may go. Past it, no orders until the wallet is topped up.`}>
                    {number('monthly_cap')}
                </Field>
            ) : (
                <div className="grid sm:grid-cols-3 gap-3">
                    <Field label={isAr ? 'السقف الشهري (ج.م)' : 'Monthly cap (EGP)'} hint={isAr ? `أقصى مبلغ ${t.v('تصرفه', 'يصرفه')} ${t.the} في الشهر.` : `The most the whole ${t.one} may spend a month.`}>
                        {number('monthly_cap')}
                    </Field>
                    <Field label={isAr ? 'مدة السداد (أيام)' : 'Payment terms (days)'} hint={isAr ? 'الفاتورة الشهرية لازم تتدفع خلال كام يوم من إصدارها.' : `Days the ${t.one} has to pay each monthly invoice.`}>
                        {number('payment_terms_days')}
                    </Field>
                    <Field label={isAr ? 'مهلة التأخير قبل الإيقاف (أيام)' : 'Grace before suspension (days)'} hint={isAr ? `لو عدى ميعاد السداد، كام يوم زيادة قبل ما الطلب على حساب ${t.the} يتوقف لوحده.` : 'Extra days after the due date before ordering on the account pauses by itself.'}>
                        {number('overdue_grace_days')}
                    </Field>
                </div>
            )}

            {changed && (
                <Notice tone="warn">
                    <p className="font-black mb-1">{isAr ? 'بتغيّر طريقة الحساب' : 'You are changing the billing method'}</p>
                    <ul className="space-y-1 font-semibold">
                        {changeNote({ company, mode: form.billing_mode, isAr, t }).filter(Boolean).map((line) => <li key={line}>{line}</li>)}
                    </ul>
                </Notice>
            )}
        </div>
    );
}
