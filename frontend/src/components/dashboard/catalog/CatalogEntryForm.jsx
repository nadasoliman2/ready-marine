'use client';

import { Plus, Trash2, Info } from 'lucide-react';
import NestedCategorySelector from '../NestedCategorySelector';
import ImageUploader from '../ImageUploader';
import CompatibilityBuilder from '../CompatibilityBuilder';
import { L } from '../../../lib/catalog';
import SearchableSelect from '../../SearchableSelect';
import { brandOptions } from '../../../lib/pickerOptions';

/**
 * The admin's editor for a catalog entry.
 *
 * It is deliberately NOT the product form: an entry carries what the product is
 * — title, images, category, brand, compatibility, the shape of its variations —
 * and nothing about an offer. There is no price, no stock, no SKU and no publish
 * status here, because those belong to whichever vendor lists it.
 *
 * Only a title and a category are required. An incomplete entry is still worth
 * having: it pre-fills what it has and the vendor completes the rest.
 */

const inputCls = 'w-full bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm focus:border-marine-cyan focus:outline-none dark:text-white';
const labelCls = 'text-xs font-bold text-zinc-500 uppercase tracking-wider';

export function blankCatalogEntry() {
    return {
        title_en: '', title_ar: '',
        subtitle_en: '', subtitle_ar: '',
        description_en: '', description_ar: '',
        category_id: '', product_brand_id: '',
        part_number: '', gtin: '',
        images: [],
        is_universal: true,
        compatible_cars: [],
        variation_types: [],
    };
}

/** An existing entry (possibly with populated refs) as editable form state. */
export function entryToFormState(entry) {
    return {
        ...blankCatalogEntry(),
        ...entry,
        category_id: String(entry.category_id?._id || entry.category_id || ''),
        product_brand_id: String(entry.product_brand_id?._id || entry.product_brand_id || ''),
        images: (entry.images || []).map((img) => ({ url: img.url, is_primary: !!img.is_primary })),
        compatible_cars: JSON.parse(JSON.stringify(entry.compatible_cars || [])),
        variation_types: (entry.variation_types || []).map((vt) => ({
            name: vt.name,
            options: (vt.options || []).map((o) => ({ value: o.value })),
        })),
    };
}

/** Only the fields the API accepts — populated refs and status never travel back. */
export function formStateToPayload(form) {
    return {
        title_en: form.title_en,
        title_ar: form.title_ar,
        subtitle_en: form.subtitle_en,
        subtitle_ar: form.subtitle_ar,
        description_en: form.description_en,
        description_ar: form.description_ar,
        category_id: form.category_id,
        product_brand_id: form.product_brand_id || null,
        part_number: form.part_number,
        gtin: form.gtin,
        images: form.images,
        is_universal: !!form.is_universal,
        compatible_cars: form.is_universal ? [] : form.compatible_cars,
        variation_types: (form.variation_types || [])
            .filter((vt) => vt.name?.trim())
            .map((vt) => ({
                name: vt.name.trim(),
                options: (vt.options || []).filter((o) => o.value?.trim()).map((o) => ({ value: o.value.trim() })),
            })),
    };
}

function Card({ title, hint, right, children }) {
    return (
        <section className="bg-white dark:bg-[#09090b] border border-zinc-200 dark:border-white/5 rounded-2xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-zinc-100 dark:border-white/5 bg-zinc-50 dark:bg-white/[0.02] flex items-center justify-between gap-4">
                <div>
                    <h3 className="font-bold text-sm text-zinc-900 dark:text-white">{title}</h3>
                    {hint && <p className="text-xs text-zinc-500 mt-0.5">{hint}</p>}
                </div>
                {right}
            </div>
            <div className="p-5">{children}</div>
        </section>
    );
}

export default function CatalogEntryForm({ form, setForm, metadata, language }) {
    const set = (patch) => setForm({ ...form, ...patch });

    const setType = (index, patch) => set({
        variation_types: form.variation_types.map((vt, i) => (i === index ? { ...vt, ...patch } : vt)),
    });

    return (
        <div className="space-y-4">
            <Card title={L(language, 'What is this product?', 'ما هذا المنتج؟')}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                    <div className="space-y-1">
                        <label className={labelCls}>{L(language, 'Title (EN)', 'العنوان (EN)')} *</label>
                        <input type="text" value={form.title_en} onChange={(e) => set({ title_en: e.target.value })} className={inputCls} />
                    </div>
                    <div className="space-y-1">
                        <label className={labelCls}>{L(language, 'Title (AR)', 'العنوان (AR)')}</label>
                        <input type="text" dir="rtl" value={form.title_ar} onChange={(e) => set({ title_ar: e.target.value })} className={inputCls} />
                    </div>
                    <div className="space-y-1">
                        <label className={labelCls}>{L(language, 'Subtitle (EN)', 'العنوان الفرعي (EN)')}</label>
                        <input type="text" value={form.subtitle_en} onChange={(e) => set({ subtitle_en: e.target.value })} className={inputCls} />
                    </div>
                    <div className="space-y-1">
                        <label className={labelCls}>{L(language, 'Subtitle (AR)', 'العنوان الفرعي (AR)')}</label>
                        <input type="text" dir="rtl" value={form.subtitle_ar} onChange={(e) => set({ subtitle_ar: e.target.value })} className={inputCls} />
                    </div>
                    <div className="sm:col-span-2 space-y-1">
                        <label className={labelCls}>{L(language, 'Description (EN)', 'الوصف (EN)')}</label>
                        <textarea rows="3" value={form.description_en} onChange={(e) => set({ description_en: e.target.value })} className={inputCls} />
                    </div>
                    <div className="sm:col-span-2 space-y-1">
                        <label className={labelCls}>{L(language, 'Description (AR)', 'الوصف (AR)')}</label>
                        <textarea rows="3" dir="rtl" value={form.description_ar} onChange={(e) => set({ description_ar: e.target.value })} className={inputCls} />
                    </div>
                </div>
            </Card>

            <Card title={L(language, 'Classification & codes', 'التصنيف والرموز')}
                hint={L(language,
                    'Part number and GTIN are optional — the catalog has no unique key, duplicates are your call.',
                    'رقم القطعة و GTIN اختياريان — لا يوجد مفتاح فريد للكتالوج، وتحديد التكرار قرارك.')}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                    <div className="space-y-1">
                        <label className={labelCls}>{L(language, 'Category', 'الفئة')} *</label>
                        <NestedCategorySelector
                            categories={metadata?.categories || []}
                            initialValue={form.category_id}
                            onChange={(leafId) => set({ category_id: leafId })}
                        />
                    </div>
                    <div className="space-y-1">
                        <label className={labelCls}>{L(language, 'Manufacturer brand', 'الماركة المصنّعة')}</label>
                        <SearchableSelect value={form.product_brand_id} onChange={(v) => set({ product_brand_id: v })} options={brandOptions(metadata?.productBrands)} placeholder={L(language, 'Select brand', 'اختر الماركة')} isAr={language === 'ar'} buttonClassName={`${inputCls} pe-9`} />
                    </div>
                    <div className="space-y-1">
                        <label className={labelCls}>{L(language, 'Part number (MPN)', 'رقم القطعة')}</label>
                        <input type="text" value={form.part_number} onChange={(e) => set({ part_number: e.target.value })} className={inputCls} />
                    </div>
                    <div className="space-y-1">
                        <label className={labelCls}>GTIN</label>
                        <input type="text" value={form.gtin} onChange={(e) => set({ gtin: e.target.value })} className={inputCls} />
                    </div>
                </div>
            </Card>

            <Card title={L(language, 'Images', 'الصور')}>
                <ImageUploader images={form.images} onChange={(images) => set({ images })} />
            </Card>

            <Card
                title={L(language, 'Vehicle compatibility', 'توافق المركبات')}
                right={
                    <label className="flex items-center gap-2 cursor-pointer text-sm font-semibold text-zinc-700 dark:text-zinc-300">
                        <input type="checkbox" checked={!!form.is_universal} onChange={(e) => set({ is_universal: e.target.checked })} className="rounded text-marine-primary focus:ring-marine-cyan" />
                        {L(language, 'Universal', 'عام')}
                    </label>
                }
            >
                {form.is_universal ? (
                    <p className="flex items-center gap-2 text-sm text-zinc-500"><Info size={15} /> {L(language, 'Fits all vehicles.', 'تناسب جميع المركبات.')}</p>
                ) : (
                    <CompatibilityBuilder
                        compatibleCars={form.compatible_cars}
                        setCompatibleCars={(cars) => set({ compatible_cars: cars })}
                        carBrands={metadata?.carBrands || []}
                    />
                )}
            </Card>

            <Card
                title={L(language, 'Options', 'الخيارات')}
                hint={L(language,
                    'The shape only — Size → S, M, L. Price and stock per variant belong to each vendor.',
                    'الشكل فقط — المقاس ← S وM وL. سعر ومخزون كل تنويع يخص كل تاجر.')}
                right={
                    <button
                        type="button"
                        onClick={() => set({ variation_types: [...form.variation_types, { name: '', options: [] }] })}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-300 hover:border-marine-cyan hover:text-marine-primary"
                    >
                        <Plus size={13} /> {L(language, 'Add type', 'إضافة نوع')}
                    </button>
                }
            >
                {form.variation_types.length === 0 ? (
                    <p className="text-sm text-zinc-500">{L(language, 'No options — this product comes one way.', 'لا توجد خيارات — هذا المنتج بشكل واحد.')}</p>
                ) : (
                    <div className="space-y-3">
                        {form.variation_types.map((vt, index) => (
                            <div key={index} className="flex flex-col sm:flex-row gap-3 items-start bg-zinc-50 dark:bg-white/[0.02] border border-zinc-200 dark:border-white/5 rounded-xl p-3">
                                <input
                                    type="text"
                                    value={vt.name}
                                    onChange={(e) => setType(index, { name: e.target.value })}
                                    placeholder={L(language, 'Type name (e.g. Size)', 'اسم النوع (مثل المقاس)')}
                                    className={`${inputCls} sm:max-w-[200px]`}
                                />
                                <input
                                    type="text"
                                    value={(vt.options || []).map((o) => o.value).join(', ')}
                                    onChange={(e) => setType(index, {
                                        options: e.target.value.split(',').map((v) => ({ value: v.trim() })).filter((o) => o.value),
                                    })}
                                    placeholder={L(language, 'Options, comma separated (S, M, L)', 'الخيارات مفصولة بفاصلة (S، M، L)')}
                                    className={inputCls}
                                />
                                <button
                                    type="button"
                                    onClick={() => set({ variation_types: form.variation_types.filter((_, i) => i !== index) })}
                                    className="p-2 text-zinc-400 hover:text-red-500"
                                >
                                    <Trash2 size={15} />
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </Card>
        </div>
    );
}
