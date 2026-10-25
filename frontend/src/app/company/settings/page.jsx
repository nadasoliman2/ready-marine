'use client';

import { useCallback, useEffect, useState } from 'react';
import { Truck, Zap, UserPlus, Trash2, Send, XCircle, ShieldCheck, Upload, Image as ImageIcon, Gauge } from 'lucide-react';
import { useApp } from '../../../context/AppContext';
import { companyPortalApi } from '../../../lib/api';
import { resolveAssetUrl } from '../../../lib/assets';
import { formatMoney, formatDate, memberStatusLabel, memberStatusClass, errorText } from '../../../lib/companyLocalization';
import {
    CARD, INPUT, BTN, PageHeader, Button, Notice, Spinner, Modal, Field, Pill,
} from '../../../components/company/CompanyUI';
import { usePortalTerms } from '../../../components/company/OrgTermsContext';

export default function CompanySettingsPage() {
    const { language } = useApp();
    const isAr = language === 'ar';
    const ot = usePortalTerms(isAr);
    const [data, setData] = useState(null);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const [defaultLimit, setDefaultLimit] = useState('');
    const [modes, setModes] = useState({ consolidate: true, instant: true });
    const [saving, setSaving] = useState('');
    const [inviteOpen, setInviteOpen] = useState(false);

    const load = useCallback(async () => {
        try {
            const res = await companyPortalApi.getSettings();
            setData(res);
            setDefaultLimit(String(res.company.default_limit));
            setModes(res.company.modes);
            setError('');
        } catch (err) {
            setError(errorText(err, isAr));
        }
    }, [isAr]);

    useEffect(() => { load(); }, [load]);

    const save = async (key, payload) => {
        setSaving(key);
        setError('');
        try {
            const res = await companyPortalApi.updateSettings(payload);
            setMessage(res.over_limit_count
                ? (isAr ? `اتحفظ. ${res.over_limit_count} ${ot.member} صرفوا أكتر من الليميت الجديد — مش هيقدروا يطلبوا لحد الشهر الجاي.` : `Saved. ${res.over_limit_count} ${ot.member}(s) already spent more than the new limit and cannot order until next month.`)
                : (isAr ? 'اتحفظ' : 'Saved'));
            await load();
        } catch (err) {
            setError(errorText(err, isAr));
        } finally {
            setSaving('');
        }
    };

    const act = async (fn, text) => {
        setError('');
        try {
            await fn();
            setMessage(text);
            await load();
        } catch (err) {
            setError(errorText(err, isAr));
        }
    };

    if (!data) return error ? <Notice>{error}</Notice> : <Spinner />;

    const toggleMode = (key) => setModes((m) => ({ ...m, [key]: !m[key] }));
    const modesChanged = modes.consolidate !== data.company.modes.consolidate || modes.instant !== data.company.modes.instant;

    return (
        <div>
            <PageHeader title={isAr ? 'الإعدادات' : 'Settings'} />
            {error && <Notice onClose={() => setError('')}>{error}</Notice>}
            {message && <Notice tone="success" onClose={() => setMessage('')}>{message}</Notice>}

            <div className="grid xl:grid-cols-2 gap-4">
                {/* Default limit */}
                <section className={`${CARD} p-5`}>
                    <h2 className="font-black text-zinc-900 dark:text-white">{isAr ? 'الليميت الافتراضي' : 'Default limit'}</h2>
                    {/* Off: nobody has a limit of their own; only the company's monthly cap stands. */}
                    <div className="mt-3 mb-4">
                        <ModeToggle
                            icon={Gauge}
                            on={data.company.employee_limits_enabled !== false}
                            onToggle={() => {
                                const turningOff = data.company.employee_limits_enabled !== false;
                                if (turningOff && !confirm(isAr
                                    ? `أي ${ot.member} هيقدر يطلب على حساب ${ot.the} من غير ليميت خاص بيه، لحد ما السقف الشهري ${ot.toThe} يخلص. نكمّل؟`
                                    : `Any ${ot.member} will be able to order on the ${ot.one} account with no limit of their own, until the ${ot.one}'s monthly cap runs out. Continue?`)) return;
                                save('limits', { employee_limits_enabled: !turningOff });
                            }}
                            title={isAr ? `ليميت لكل ${ot.member}` : `A limit for each ${ot.member}`}
                            body={data.company.employee_limits_enabled !== false
                                ? (isAr ? `كل ${ot.member} ليه ليميت شهري (الافتراضي، أو الجروب، أو ليميت خاص).` : `Each ${ot.member} has a monthly limit (the default, their group's, or a personal one).`)
                                : (isAr ? `مقفول: أي ${ot.member} يطلب عادي، والحد الوحيد هو السقف الشهري ${ot.toThe}.` : `Off: any ${ot.member} may order; the only bound is the ${ot.one}'s monthly cap.`)}
                        />
                    </div>
                    {data.company.employee_limits_enabled !== false && (<>
                    <p className="text-sm text-zinc-500 mt-1 mb-4">
                        {isAr
                            ? `اللي يقدر يصرفه كل ${ot.member} في الشهر على حساب ${ot.the} لو مش في جروب ومالهوش ليميت خاص. شامل الشحن.`
                            : `What each ${ot.member} may spend a month on the ${ot.one} account when in no group and with no personal limit. Shipping included.`}
                    </p>
                    <div className="flex flex-wrap items-end gap-3">
                        <Field label={isAr ? 'في الشهر' : 'Per month'} className="flex-1 min-w-[160px]">
                            <input type="number" min="0" step="1" dir="ltr" className={`${INPUT} w-full`} value={defaultLimit} onChange={(e) => setDefaultLimit(e.target.value)} />
                        </Field>
                        <Button loading={saving === 'limit'} disabled={defaultLimit === '' || Number(defaultLimit) === data.company.default_limit}
                            onClick={() => save('limit', { default_limit: Number(defaultLimit) })}>
                            {isAr ? 'حفظ' : 'Save'}
                        </Button>
                    </div>
                    </>)}
                    <p className="text-xs text-zinc-400 mt-3">
                        {isAr
                            ? `السقف الشهري ${ot.toThe} ${ot.v('كلها', 'كله')} (بتحدده Ready Marine): ${formatMoney(data.company.monthly_cap, true)}`
                            : `The whole ${ot.one}'s monthly cap (set by Ready Marine): ${formatMoney(data.company.monthly_cap, false)}`}
                    </p>
                </section>

                {/* Delivery modes */}
                <section className={`${CARD} p-5`}>
                    <h2 className="font-black text-zinc-900 dark:text-white">{isAr ? 'مودات التوصيل' : 'Delivery modes'}</h2>
                    <p className="text-sm text-zinc-500 mt-1 mb-4">
                        {isAr ? `${ot.theMember} بيختار من المودات اللي شغالة وهو بيطلب.` : `${ot.Members} choose between the modes that are on when they order.`}
                    </p>
                    <div className="space-y-3">
                        <ModeToggle
                            icon={Truck}
                            on={modes.consolidate}
                            onToggle={() => toggleMode('consolidate')}
                            title={isAr ? `تجميع على ${ot.theBranch}` : `Consolidate to ${ot.branch}`}
                            body={isAr
                                ? `أوردرات ${ot.members} من نفس المورد بتستنى شوية وتتشحن طرد واحد على ${ot.theBranch}، والشحن بيتقسم عليهم. أوفر ${ot.toThe}.`
                                : `Colleagues' orders from the same vendor wait briefly and ship as one parcel to the ${ot.branch}, splitting the shipping. Cheaper for the ${ot.one}.`}
                        />
                        <ModeToggle
                            icon={Zap}
                            on={modes.instant}
                            onToggle={() => toggleMode('instant')}
                            title={isAr ? 'فوري' : 'Instant'}
                            body={isAr ? `الأوردر بيتحرك على طول بشحن كامل، على البيت أو ${ot.theBranch}.` : `The order ships right away with full shipping, to home or the ${ot.branch}.`}
                        />
                    </div>
                    <div className="flex justify-end mt-4">
                        <Button loading={saving === 'modes'} disabled={!modesChanged || (!modes.consolidate && !modes.instant)}
                            onClick={() => save('modes', { modes })}>
                            {isAr ? 'حفظ' : 'Save'}
                        </Button>
                    </div>
                    {!modes.consolidate && !modes.instant && (
                        <p className="text-xs text-red-500 mt-2">{isAr ? 'لازم مود واحد على الأقل يفضل شغال.' : 'Keep at least one mode on.'}</p>
                    )}
                </section>

                {/* Logo — shown on Ready Marine's home page among its corporate clients */}
                <section className={`${CARD} p-5 xl:col-span-2`}>
                    <h2 className="font-black text-zinc-900 dark:text-white">{isAr ? `لوجو ${ot.the}` : `${ot.One} logo`}</h2>
                    <p className="text-sm text-zinc-500 mt-1 mb-4">
                        {isAr
                            ? `بيظهر في الصفحة الرئيسية لريدي مارين في سيكشن "عملاء ريدي مارين من المؤسسات"، لو سايب الاختيار ده شغال. PNG أو JPG أو WebP لحد 2 ميجا — والأفضل خلفية شفافة.`
                            : `Shown on Ready Marine's home page under "Ready Marine's corporate clients" while the option below is on. PNG, JPG or WebP up to 2 MB — a transparent background works best.`}
                    </p>
                    <div className="flex flex-wrap items-center gap-4">
                        <div className="w-44 h-24 rounded-xl border border-dashed border-zinc-200 dark:border-white/10 bg-white flex items-center justify-center px-3">
                            {data.company.logo
                                // eslint-disable-next-line @next/next/no-img-element
                                ? <img src={resolveAssetUrl(data.company.logo)} alt="" className="max-h-16 max-w-full object-contain" />
                                : <ImageIcon size={22} className="text-zinc-300" />}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <label className={`${BTN.secondary} cursor-pointer ${saving === 'logo' ? 'opacity-50 pointer-events-none' : ''}`}>
                                <Upload size={16} />
                                {data.company.logo ? (isAr ? 'غيّر اللوجو' : 'Replace logo') : (isAr ? 'ارفع اللوجو' : 'Upload logo')}
                                <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={async (e) => {
                                    const file = e.target.files?.[0];
                                    e.target.value = '';
                                    if (!file) return;
                                    setSaving('logo');
                                    await act(() => companyPortalApi.uploadLogo(file), isAr ? 'اللوجو اترفع' : 'Logo uploaded');
                                    setSaving('');
                                }} />
                            </label>
                            {data.company.logo && (
                                <Button variant="ghost" icon={Trash2} onClick={() => act(() => companyPortalApi.removeLogo(), isAr ? 'اللوجو اتشال' : 'Logo removed')}>
                                    {isAr ? 'شيل اللوجو' : 'Remove'}
                                </Button>
                            )}
                        </div>
                    </div>
                    <label className="mt-4 flex items-start gap-2 text-sm font-bold text-zinc-800 dark:text-zinc-100">
                        <input
                            type="checkbox"
                            className="accent-marine-cyan w-4 h-4 mt-0.5"
                            checked={data.company.show_logo_on_homepage}
                            disabled={saving === 'show_logo'}
                            onChange={(e) => save('show_logo', { show_logo_on_homepage: e.target.checked })}
                        />
                        <span>
                            {isAr ? 'اعرض اللوجو في الصفحة الرئيسية لريدي مارين' : "Show the logo on Ready Marine's home page"}
                            {!data.company.logo && <span className="block text-xs font-medium text-zinc-400">{isAr ? 'هيظهر أول ما ترفع اللوجو.' : 'It appears once a logo is uploaded.'}</span>}
                        </span>
                    </label>
                </section>

                {/* Managers */}
                <section className={`${CARD} p-5 xl:col-span-2`}>
                    <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                        <div>
                            <h2 className="font-black text-zinc-900 dark:text-white">{isAr ? 'مديرين الحساب' : 'Account managers'}</h2>
                            <p className="text-sm text-zinc-500 mt-1">{isAr ? 'كلهم ليهم نفس الصلاحيات. لازم يفضل مدير واحد على الأقل.' : 'All have the same permissions. At least one must remain.'}</p>
                        </div>
                        <Button icon={UserPlus} onClick={() => setInviteOpen(true)}>{isAr ? 'إضافة مدير' : 'Add a manager'}</Button>
                    </div>
                    <ul className="divide-y divide-zinc-100 dark:divide-white/5">
                        {data.managers.map((m) => (
                            <li key={m.membership_id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                                <div className="min-w-0">
                                    <p className="font-bold text-zinc-900 dark:text-white">
                                        {m.user?.name}
                                        {m.is_me && <span className="ms-2 text-[10px] font-black uppercase text-zinc-400">{isAr ? 'إنت' : 'You'}</span>}
                                        {m.is_employee && <span className="ms-2 text-[10px] font-black uppercase text-emerald-600">{isAr ? `${ot.member} كمان` : `Also ${ot.aMember}`}</span>}
                                    </p>
                                    <p className="text-xs text-zinc-500" dir="ltr">{m.user?.email || m.user?.phone}</p>
                                </div>
                                {data.managers.length > 1 && (
                                    <Button variant="danger" icon={Trash2}
                                        onClick={() => { if (confirm(isAr ? `شيل ${m.user?.name} من المديرين؟` : `Remove ${m.user?.name} as a manager?`)) act(() => companyPortalApi.removeManager(m.membership_id), isAr ? 'اتشال' : 'Removed'); }}>
                                        {isAr ? 'شيل' : 'Remove'}
                                    </Button>
                                )}
                            </li>
                        ))}
                        {data.manager_invitations.map((inv) => (
                            <li key={inv._id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                                <div className="min-w-0">
                                    <p className="font-bold text-zinc-900 dark:text-white flex items-center gap-2">
                                        {inv.name || (isAr ? 'مدير مدعو' : 'Invited manager')}
                                        <Pill className={memberStatusClass(inv.status)}>{memberStatusLabel(inv.status, isAr)}</Pill>
                                    </p>
                                    <p className="text-xs text-zinc-500" dir="ltr">{inv.email || inv.phone} · {formatDate(inv.expires_at, isAr)}</p>
                                </div>
                                <div className="flex gap-2">
                                    <Button variant="secondary" icon={Send} onClick={() => act(() => companyPortalApi.resendInvitation(inv._id, isAr ? 'ar' : 'en'), isAr ? 'الدعوة اتبعتت تاني' : 'Invitation resent')}>
                                        {isAr ? 'ابعت تاني' : 'Resend'}
                                    </Button>
                                    <Button variant="ghost" icon={XCircle} onClick={() => act(() => companyPortalApi.revokeInvitation(inv._id), isAr ? 'الدعوة اتلغت' : 'Invitation cancelled')}>
                                        {isAr ? 'إلغاء' : 'Cancel'}
                                    </Button>
                                </div>
                            </li>
                        ))}
                    </ul>
                    {!data.me.is_employee && (
                        <p className="text-xs text-zinc-500 mt-4 flex items-start gap-2">
                            <ShieldCheck size={14} className="mt-0.5 shrink-0" />
                            {isAr
                                ? `حسابك للإدارة وطلب قطع عربيات ${ot.the}. لو عايز ليميت شخصي زي ${ot.members}، ضيف نفسك من صفحة ${ot.members} بإيميلك أو رقمك.`
                                : `Your account runs the ${ot.one} and orders for ${ot.one} cars. For a personal limit like ${ot.members} have, add yourself on the ${ot.Members} page with your email or number.`}
                        </p>
                    )}
                </section>
            </div>

            <InviteManagerModal
                open={inviteOpen}
                isAr={isAr}
                onClose={() => setInviteOpen(false)}
                onDone={async (text) => { setInviteOpen(false); setMessage(text); await load(); }}
            />
        </div>
    );
}

function ModeToggle({ icon: Icon, on, onToggle, title, body }) {
    return (
        <button
            type="button"
            onClick={onToggle}
            className={`w-full text-start flex items-start gap-3 rounded-xl border p-4 transition-all ${on
                ? 'border-marine-cyan bg-red-50/50 dark:bg-marine-cyan/5'
                : 'border-zinc-200 dark:border-white/10'}`}
        >
            <Icon size={20} className={on ? 'text-marine-primary mt-0.5' : 'text-zinc-400 mt-0.5'} />
            <div className="flex-1">
                <p className="font-bold text-sm text-zinc-900 dark:text-white">{title}</p>
                <p className="text-xs text-zinc-500 mt-0.5">{body}</p>
            </div>
            <span className={`mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${on ? 'bg-marine-cyan' : 'bg-zinc-300 dark:bg-zinc-600'}`}>
                <span className={`h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-5 rtl:-translate-x-5' : 'translate-x-0.5 rtl:-translate-x-0.5'}`} />
            </span>
        </button>
    );
}

function InviteManagerModal({ open, isAr, onClose, onDone }) {
    const ot = usePortalTerms(isAr);
    const [form, setForm] = useState({ name: '', identifier: '' });
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => { if (open) { setForm({ name: '', identifier: '' }); setError(''); } }, [open]);

    const submit = async () => {
        setBusy(true);
        setError('');
        try {
            const res = await companyPortalApi.inviteManager({ ...form, language: isAr ? 'ar' : 'en' });
            onDone(res.direct
                ? (isAr ? `بقى مدير على طول (كان ${ot.member} في ${ot.the})` : `Made a manager straight away (they were already ${ot.aMember})`)
                : (isAr ? 'الدعوة اتبعتت' : 'Invitation sent'));
        } catch (err) {
            setError(errorText(err, isAr));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Modal
            open={open}
            onClose={onClose}
            title={isAr ? 'إضافة مدير' : 'Add a manager'}
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>{isAr ? 'إلغاء' : 'Cancel'}</Button>
                    <Button onClick={submit} loading={busy} disabled={!form.identifier.trim()}>{isAr ? 'ابعت الدعوة' : 'Send invitation'}</Button>
                </>
            )}
        >
            {error && <Notice>{error}</Notice>}
            <div className="space-y-4">
                <Field label={isAr ? 'الاسم (اختياري)' : 'Name (optional)'}>
                    <input className={`${INPUT} w-full`} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </Field>
                <Field label={isAr ? 'الإيميل أو رقم الموبايل' : 'Email or mobile number'}>
                    <input dir="ltr" className={`${INPUT} w-full`} value={form.identifier} onChange={(e) => setForm({ ...form, identifier: e.target.value })} />
                </Field>
            </div>
        </Modal>
    );
}
