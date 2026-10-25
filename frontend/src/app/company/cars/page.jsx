'use client';

import { useCallback, useEffect, useState } from 'react';
import { Car, Plus, Pencil, Trash2 } from 'lucide-react';
import { useApp } from '../../../context/AppContext';
import { companyPortalApi } from '../../../lib/api';
import { formatMoney, errorText } from '../../../lib/companyLocalization';
import { useBrandModels } from '../../../lib/carBrandModels';
import SearchableSelect from '../../../components/SearchableSelect';
import { makeOptions, modelOptions, yearOptions } from '../../../lib/pickerOptions';
import { refreshMyCompany } from '../../../components/company/useMyCompany';
import {
    CARD, INPUT, PageHeader, Button, Notice, Spinner, EmptyState, Modal, Field, TableWrap, Th, Td,
} from '../../../components/company/CompanyUI';
import { usePortalTerms } from '../../../components/company/OrgTermsContext';

const EMPTY_CAR = { car_brand_id: '', car_model_id: '', year: '', plate: '' };
const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

/**
 * Company cars: the fleet a manager orders parts for. Each company-car order is
 * tagged with one of these, so the ledger shows spend per car. A car is picked from
 * the site's make/model/year list, like a garage car, so the shop can show the
 * parts that fit it.
 */
export default function CompanyCarsPage() {
    const { language } = useApp();
    const isAr = language === 'ar';
    const ot = usePortalTerms(isAr);
    const [cars, setCars] = useState(null);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const [editing, setEditing] = useState(null);
    const [carBrands, setCarBrands] = useState([]);

    useEffect(() => {
        fetch(`${API}/products/filters`)
            .then((res) => (res.ok ? res.json() : { carBrands: [] }))
            .then((data) => setCarBrands(data.carBrands || []))
            .catch(() => setCarBrands([]));
    }, []);

    const load = useCallback(async () => {
        try {
            setCars((await companyPortalApi.getCars()).cars);
            setError('');
        } catch (err) {
            setError(errorText(err, isAr));
        }
    }, [isAr]);

    useEffect(() => { load(); }, [load]);

    const remove = async (car) => {
        if (!confirm(isAr ? `مسح العربية ${car.plate}؟ الأوردرات اللي اتطلبت ليها هتفضل في السجل.` : `Remove ${car.plate}? Past orders for it stay in the records.`)) return;
        try {
            await companyPortalApi.deleteCar(car._id);
            setMessage(isAr ? 'العربية اتمسحت' : 'Car removed');
            await load();
            refreshMyCompany().catch(() => {}); // the shop's "Fits my car" list
        } catch (err) {
            setError(errorText(err, isAr));
        }
    };

    if (!cars) return error ? <Notice>{error}</Notice> : <Spinner />;

    return (
        <div>
            <PageHeader
                title={isAr ? `عربيات ${ot.the}` : `${ot.One} cars`}
                subtitle={isAr ? `العربيات اللي بتطلب ليها قطع غيار على حساب ${ot.the}.` : `The cars you order parts for on the ${ot.one} account.`}
                actions={<Button icon={Plus} onClick={() => setEditing({ ...EMPTY_CAR })}>{isAr ? 'إضافة عربية' : 'Add a car'}</Button>}
            />
            {error && <Notice onClose={() => setError('')}>{error}</Notice>}
            {message && <Notice tone="success" onClose={() => setMessage('')}>{message}</Notice>}

            <div className={CARD}>
                {cars.length === 0 ? (
                    <EmptyState
                        icon={Car}
                        title={isAr ? 'لسه مفيش عربيات' : 'No cars yet'}
                        message={isAr ? `سجل عربيات ${ot.the} عشان تطلب ليها قطع وتعرف صرفت كام على كل عربية.` : `Register the ${ot.one} cars to order parts for them and see what each one costs.`}
                    />
                ) : (
                    <TableWrap>
                        <table className="w-full min-w-[560px]">
                            <thead className="border-b border-zinc-100 dark:border-white/5">
                                <tr>
                                    <Th align="start">{isAr ? 'رقم اللوحة' : 'Plate'}</Th>
                                    <Th align="start">{isAr ? 'العربية' : 'Car'}</Th>
                                    <Th align="start">{isAr ? 'صرف الشهر' : 'Spent this month'}</Th>
                                    <Th align="end">{isAr ? 'إجراءات' : 'Actions'}</Th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
                                {cars.map((car) => (
                                    <tr key={car._id}>
                                        <Td align="start" className="font-black text-zinc-900 dark:text-white">{car.plate}</Td>
                                        <Td align="start" className="text-zinc-600 dark:text-zinc-300">
                                            {[car.year, car.make, car.model].filter(Boolean).join(' ')}
                                            {!car.car_model_id && (
                                                <span className="block text-[11px] font-bold text-amber-600">{isAr ? 'عدّلها واختار الموديل من القايمة عشان تظهر في "يناسب عربيتي"' : 'Edit it and pick the model from the list so it shows under "Fits my car"'}</span>
                                            )}
                                        </Td>
                                        <Td align="start"><span dir="ltr" className="tabular-nums">{formatMoney(car.month_spent, isAr)}</span></Td>
                                        <Td align="end">
                                            <div className="inline-flex gap-1">
                                                <button type="button" onClick={() => setEditing(car)} className="p-2 rounded-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-white/5" title={isAr ? 'تعديل' : 'Edit'}><Pencil size={16} /></button>
                                                <button type="button" onClick={() => remove(car)} className="p-2 rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10" title={isAr ? 'مسح' : 'Remove'}><Trash2 size={16} /></button>
                                            </div>
                                        </Td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </TableWrap>
                )}
            </div>

            <CarModal
                car={editing}
                carBrands={carBrands}
                isAr={isAr}
                onClose={() => setEditing(null)}
                onSaved={async (text) => { setEditing(null); setMessage(text); await load(); refreshMyCompany().catch(() => {}); }}
            />
        </div>
    );
}

function CarModal({ car, carBrands, isAr, onClose, onSaved }) {
    const [form, setForm] = useState(EMPTY_CAR);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const isNew = car && !car._id;

    const brandModels = useBrandModels(carBrands.find((b) => String(b._id) === String(form.car_brand_id)));
    const years = brandModels.find((m) => String(m._id) === String(form.car_model_id))?.years || [];

    useEffect(() => {
        if (car) {
            setForm({
                ...EMPTY_CAR,
                car_brand_id: car.car_brand_id || '',
                car_model_id: car.car_model_id || '',
                year: car.year || '',
                plate: car.plate || '',
            });
            setError('');
        }
    }, [car]);

    if (!car) return null;

    const save = async () => {
        setBusy(true);
        setError('');
        const payload = { car_brand_id: form.car_brand_id, car_model_id: form.car_model_id, year: Number(form.year), plate: form.plate };
        try {
            if (isNew) await companyPortalApi.createCar(payload);
            else await companyPortalApi.updateCar(car._id, payload);
            onSaved(isAr ? 'اتحفظ' : 'Saved');
        } catch (err) {
            setError(errorText(err, isAr));
        } finally {
            setBusy(false);
        }
    };

    const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

    if (!car) return null;

    return (
        <Modal
            open={!!car}
            onClose={onClose}
            title={isNew ? (isAr ? 'إضافة عربية' : 'Add a car') : (isAr ? 'تعديل العربية' : 'Edit car')}
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>{isAr ? 'إلغاء' : 'Cancel'}</Button>
                    <Button onClick={save} loading={busy} disabled={!form.car_model_id || !form.year || !form.plate.trim()}>{isAr ? 'حفظ' : 'Save'}</Button>
                </>
            )}
        >
            {error && <Notice>{error}</Notice>}
            {!isNew && !car.car_model_id && (
                <Notice tone="warn">
                    {isAr
                        ? `العربية دي متسجلة "${[car.make, car.model].filter(Boolean).join(' ')}". اختار الماركة والموديل من القايمة عشان الموقع يعرض القطع المناسبة ليها.`
                        : `This car was saved as "${[car.make, car.model].filter(Boolean).join(' ')}". Pick the make and model from the list so the shop can show the parts that fit it.`}
                </Notice>
            )}
            <div className="grid sm:grid-cols-2 gap-4">
                <Field label={isAr ? 'الماركة' : 'Make'}>
                    {/* Searchable, the makes with their logos, as everywhere a car is picked. */}
                    <SearchableSelect buttonClassName={`${INPUT} w-full pe-9`} isAr={isAr} value={form.car_brand_id}
                        onChange={(v) => setForm({ ...form, car_brand_id: v, car_model_id: '', year: '' })}
                        options={makeOptions(carBrands)} placeholder={isAr ? 'اختار الماركة' : 'Choose the make'} />
                </Field>
                <Field label={isAr ? 'الموديل' : 'Model'}>
                    <SearchableSelect buttonClassName={`${INPUT} w-full pe-9`} isAr={isAr} disabled={!form.car_brand_id} value={form.car_model_id}
                        onChange={(v) => setForm({ ...form, car_model_id: v, year: '' })}
                        options={modelOptions(brandModels)} placeholder={isAr ? 'اختار الموديل' : 'Choose the model'} />
                </Field>
                <Field label={isAr ? 'سنة الصنع' : 'Year'}>
                    <SearchableSelect buttonClassName={`${INPUT} w-full pe-9`} isAr={isAr} disabled={!form.car_model_id} value={String(form.year || '')}
                        onChange={(v) => setForm({ ...form, year: v })}
                        options={yearOptions(years)} placeholder={isAr ? 'اختار السنة' : 'Choose the year'} />
                </Field>
                <Field label={isAr ? 'رقم اللوحة' : 'Plate number'}><input className={`${INPUT} w-full`} value={form.plate} onChange={set('plate')} placeholder={isAr ? 'أ ب ج 123' : 'ABC 123'} /></Field>
            </div>
        </Modal>
    );
}
