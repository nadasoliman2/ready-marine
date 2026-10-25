'use client';

import { useCallback, useEffect, useState } from 'react';
import { Building2, Plus, Pencil, Trash2, MapPin, Phone, CheckCircle2 } from 'lucide-react';
import { useApp } from '../../../context/AppContext';
import { companyPortalApi } from '../../../lib/api';
import { errorText } from '../../../lib/companyLocalization';
import ShippingZoneSelect from '../../../components/ShippingZoneSelect';
import {
    CARD, INPUT, PageHeader, Button, Notice, Spinner, Modal, Field,
} from '../../../components/company/CompanyUI';
import { usePortalTerms } from '../../../components/company/OrgTermsContext';

const EMPTY_OFFICE = { name: '', recipient_name: '', phone: '', full_address: '', shipping_country: '', shipping_city: '' };

/**
 * Offices: where consolidated parcels are delivered. Every employee belongs to
 * one; consolidation happens per office, because a parcel for Cairo and one for
 * Alexandria can never be the same parcel.
 */
export default function CompanyOfficesPage() {
    const { language } = useApp();
    const isAr = language === 'ar';
    const ot = usePortalTerms(isAr);
    const [data, setData] = useState(null);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const [editing, setEditing] = useState(null);
    const [confirming, setConfirming] = useState(false);

    const load = useCallback(async () => {
        try {
            setData(await companyPortalApi.getOffices());
            setError('');
        } catch (err) {
            setError(errorText(err, isAr));
        }
    }, [isAr]);

    useEffect(() => { load(); }, [load]);

    const remove = async (office) => {
        const text = isAr
            ? `مسح ${ot.branch} "${office.name}"؟ ${ot.members} التابعين له (${office.employees}) هيتنقلوا لأول ${ot.branch}.`
            : `Remove "${office.name}"? Its ${office.employees} ${ot.member}(s) move to the first ${ot.branch}.`;
        if (!confirm(text)) return;
        try {
            await companyPortalApi.deleteOffice(office._id);
            setMessage(isAr ? `${ot.theBranch} اتمسح` : `${ot.Branch} removed`);
            await load();
        } catch (err) {
            setError(errorText(err, isAr));
        }
    };

    const confirmOffice = async () => {
        setConfirming(true);
        try {
            await companyPortalApi.confirmSetupStep('office');
            await load();
        } catch (err) {
            setError(errorText(err, isAr));
        } finally {
            setConfirming(false);
        }
    };

    if (!data) return error ? <Notice>{error}</Notice> : <Spinner />;

    return (
        <div>
            <PageHeader
                title={isAr ? `${ot.branches}` : `${ot.Branches}`}
                subtitle={isAr ? `عناوين ${ot.the} اللي الطرود المجمّعة بتتوصل عليها.` : `The ${ot.one} addresses consolidated parcels are delivered to.`}
                actions={<Button icon={Plus} onClick={() => setEditing({ ...EMPTY_OFFICE })}>{isAr ? `${ot.branch} جديد` : `New ${ot.branch}`}</Button>}
            />
            {error && <Notice onClose={() => setError('')}>{error}</Notice>}
            {message && <Notice tone="success" onClose={() => setMessage('')}>{message}</Notice>}
            {!data.office_confirmed && (
                <Notice tone="info">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <span>{isAr ? `راجع عنوان ${ot.theBranch} اللي Ready Marine سجلته. لو مظبوط أكده، ولو لأ عدّله.` : `Check the ${ot.branch} address Ready Marine entered. Confirm it if it is right, or edit it.`}</span>
                        <Button variant="success" icon={CheckCircle2} loading={confirming} onClick={confirmOffice}>{isAr ? 'العنوان مظبوط' : "It's correct"}</Button>
                    </div>
                </Notice>
            )}

            <div className="grid md:grid-cols-2 gap-4">
                {data.offices.map((office) => (
                    <div key={office._id} className={`${CARD} p-5`}>
                        <div className="flex items-start justify-between gap-3">
                            <div className="flex items-center gap-3 min-w-0">
                                <div className="w-10 h-10 rounded-xl bg-red-50 dark:bg-marine-cyan/10 text-marine-primary flex items-center justify-center shrink-0"><Building2 size={18} /></div>
                                <div className="min-w-0">
                                    <p className="font-black text-zinc-900 dark:text-white truncate">{office.name}</p>
                                    <p className="text-xs text-zinc-500">{isAr ? `${office.employees} ${ot.member}` : `${office.employees} ${ot.member}(s)`}</p>
                                </div>
                            </div>
                            <div className="flex gap-1">
                                <button type="button" onClick={() => setEditing(office)} className="p-2 rounded-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-white/5" title={isAr ? 'تعديل' : 'Edit'}><Pencil size={16} /></button>
                                {data.offices.length > 1 && (
                                    <button type="button" onClick={() => remove(office)} className="p-2 rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10" title={isAr ? 'مسح' : 'Remove'}><Trash2 size={16} /></button>
                                )}
                            </div>
                        </div>
                        <div className="mt-4 space-y-1.5 text-sm text-zinc-600 dark:text-zinc-300">
                            <p className="flex items-start gap-2"><MapPin size={14} className="mt-0.5 shrink-0 text-zinc-400" />{office.full_address}{office.shipping_city ? ` — ${office.shipping_city}` : ''}</p>
                            <p className="flex items-center gap-2"><Phone size={14} className="shrink-0 text-zinc-400" /><span>{office.recipient_name}</span> · <span dir="ltr">{office.phone}</span></p>
                        </div>
                    </div>
                ))}
            </div>

            <OfficeModal
                office={editing}
                isAr={isAr}
                onClose={() => setEditing(null)}
                onSaved={async (text) => { setEditing(null); setMessage(text); await load(); }}
            />
        </div>
    );
}

function OfficeModal({ office, isAr, onClose, onSaved }) {
    const ot = usePortalTerms(isAr);
    const [form, setForm] = useState(EMPTY_OFFICE);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const isNew = office && !office._id;

    useEffect(() => {
        if (office) {
            setForm({ ...EMPTY_OFFICE, ...office });
            setError('');
        }
    }, [office]);

    if (!office) return null;

    const save = async () => {
        setBusy(true);
        setError('');
        const payload = {
            name: form.name,
            recipient_name: form.recipient_name,
            phone: form.phone,
            full_address: form.full_address,
            shipping_country: form.shipping_country,
            shipping_city: form.shipping_city,
        };
        try {
            if (isNew) await companyPortalApi.createOffice(payload);
            else await companyPortalApi.updateOffice(office._id, payload);
            onSaved(isAr ? 'اتحفظ' : 'Saved');
        } catch (err) {
            setError(errorText(err, isAr));
        } finally {
            setBusy(false);
        }
    };

    const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

    return (
        <Modal
            open={!!office}
            onClose={onClose}
            title={isNew ? (isAr ? `${ot.branch} جديد` : `New ${ot.branch}`) : (isAr ? `تعديل ${ot.theBranch}` : `Edit ${ot.branch}`)}
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>{isAr ? 'إلغاء' : 'Cancel'}</Button>
                    <Button onClick={save} loading={busy}>{isAr ? 'حفظ' : 'Save'}</Button>
                </>
            )}
        >
            {error && <Notice>{error}</Notice>}
            <div className="space-y-4">
                <Field label={isAr ? `اسم ${ot.theBranch}` : `${ot.Branch} name`}>
                    <input className={`${INPUT} w-full`} value={form.name} onChange={set('name')} placeholder={isAr ? `مثلاً: ${ot.theBranch} الرئيسي` : `e.g. Main ${ot.branch}`} />
                </Field>
                <div className="grid sm:grid-cols-2 gap-3">
                    <Field label={isAr ? `اسم اللي بيستلم الطرود في ${ot.theBranch}` : `Who receives parcels at the ${ot.branch}`} hint={isAr ? `بيتكتب على بوليصة الشحن جنب اسم ${ot.theMember}، عشان المندوب يسلّم للاستقبال أو الأمن.` : `Printed on the waybill beside the ${ot.member}'s name, so the courier hands it to reception or security.`}>
                        <input className={`${INPUT} w-full`} value={form.recipient_name} onChange={set('recipient_name')} placeholder={isAr ? 'مثلاً: الاستقبال' : 'e.g. Reception'} />
                    </Field>
                    <Field label={isAr ? 'موبايل الاستلام' : 'Receiving mobile'}>
                        <input dir="ltr" className={`${INPUT} w-full`} value={form.phone} onChange={set('phone')} placeholder="01xxxxxxxxx" />
                    </Field>
                </div>
                <ShippingZoneSelect
                    variant="dashboard"
                    country={form.shipping_country || ''}
                    city={form.shipping_city || ''}
                    onChange={({ country, city }) => setForm((f) => ({ ...f, shipping_country: country, shipping_city: city }))}
                />
                <Field label={isAr ? 'العنوان بالتفصيل' : 'Full address'}>
                    <textarea rows={3} className={`${INPUT} w-full resize-none`} value={form.full_address} onChange={set('full_address')} />
                </Field>
            </div>
        </Modal>
    );
}
