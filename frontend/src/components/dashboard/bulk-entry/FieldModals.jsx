'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useApp } from '../../../context/AppContext';
import { L } from './bulkEntryUtils';
import { categoriesForBrand, indexCategoryTree } from '../../../lib/brandCategoryLink';
import NestedCategorySelector from '../NestedCategorySelector';
import ImageUploader from '../ImageUploader';
import CompatibilityBuilder from '../CompatibilityBuilder';
import VariationBuilder from '../VariationBuilder';
import ProductShippingFields from '../ProductShippingFields';
import Overlay from '../../Overlay';

const inputCls = 'w-full bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm focus:border-marine-cyan focus:outline-none dark:text-white';

/** `subtitle`: one line under the title (the product the popup edits), whole on hover. */
export function Modal({ title, subtitle, onClose, onSave, children, wide }) {
    const { language } = useApp();
    useEffect(() => {
        const h = (e) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', h);
        return () => window.removeEventListener('keydown', h);
    }, [onClose]);

    return (
        <Overlay className="fixed inset-0 z-[120] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
            <div className={`relative bg-white dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 rounded-2xl shadow-2xl w-full ${wide ? 'max-w-4xl' : 'max-w-2xl'} max-h-[88vh] flex flex-col`}>
                <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-zinc-100 dark:border-white/10">
                    <div className="min-w-0">
                        <h3 className="font-bold text-zinc-900 dark:text-white">{title}</h3>
                        {subtitle && <p className="text-sm text-zinc-500 dark:text-zinc-400 truncate" title={subtitle}>{subtitle}</p>}
                    </div>
                    <button onClick={onClose} className="shrink-0 p-1.5 rounded-lg text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-white/5">
                        <X size={18} />
                    </button>
                </div>
                <div className="px-5 py-4 overflow-y-auto">{children}</div>
                <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-zinc-100 dark:border-white/10">
                    <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-semibold border border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-white/5">
                        {L(language, 'Cancel', 'إلغاء')}
                    </button>
                    {onSave && (
                        <button onClick={onSave} className="px-4 py-2 rounded-lg text-sm font-bold bg-marine-cyan hover:bg-marine-cyan-dark text-white">
                            {L(language, 'Done', 'تم')}
                        </button>
                    )}
                </div>
            </div>
        </Overlay>
    );
}

function Field({ label, full, children }) {
    return (
        <div className={`space-y-1 ${full ? 'col-span-2' : ''}`}>
            <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">{label}</label>
            {children}
        </div>
    );
}

export function CategoryModal({ row, refs, onSave, onClose }) {
    const { language } = useApp();
    const [val, setVal] = useState(row.category_id || '');
    const notLeaf = val && refs?.leafIds && !refs.leafIds.has(String(val));
    // Only the categories the row's brand makes things for; the whole tree if no brand yet.
    const brand = (refs?.metadata?.productBrands || []).find((b) => String(b._id) === String(row.product_brand_id));
    const allowedForBrand = brand ? categoriesForBrand(brand, refs?.categoryIndex || indexCategoryTree(refs?.metadata?.categories || [])) : null;
    return (
        <Modal title={L(language, 'Category', 'الفئة')} onClose={onClose} onSave={() => { onSave({ category_id: val }); onClose(); }}>
            <NestedCategorySelector
                categories={refs?.metadata?.categories || []}
                allowedIds={allowedForBrand}
                initialValue={val}
                onChange={setVal}
            />
            {notLeaf && (
                <p className="text-xs text-amber-500 mt-3">
                    {L(language, 'Pick a final category that has no subcategories.', 'اختر فئة نهائية ليس لها فئات فرعية.')}
                </p>
            )}
        </Modal>
    );
}

export function ContentModal({ row, onSave, onClose }) {
    const { language } = useApp();
    const [f, setF] = useState({
        subtitle_en: row.subtitle_en || '', subtitle_ar: row.subtitle_ar || '',
        description_en: row.description_en || '', description_ar: row.description_ar || '',
    });
    const upd = (k, v) => setF((p) => ({ ...p, [k]: v }));
    return (
        <Modal wide title={L(language, 'Content (EN / AR)', 'المحتوى (إنجليزي / عربي)')} onClose={onClose} onSave={() => { onSave(f); onClose(); }}>
            <p className="text-xs text-zinc-500 mb-4">
                {L(language, 'A product needs a complete English OR Arabic set: Title (in the grid) + Subtitle + Description.', 'يحتاج المنتج لمجموعة إنجليزية أو عربية كاملة: العنوان (في الجدول) + العنوان الفرعي + الوصف.')}
            </p>
            <div className="grid grid-cols-2 gap-4">
                <Field label={L(language, 'Subtitle (EN)', 'العنوان الفرعي (إنجليزي)')}><input className={inputCls} value={f.subtitle_en} onChange={(e) => upd('subtitle_en', e.target.value)} /></Field>
                <Field label={L(language, 'Subtitle (AR)', 'العنوان الفرعي (عربي)')}><input dir="rtl" className={inputCls} value={f.subtitle_ar} onChange={(e) => upd('subtitle_ar', e.target.value)} /></Field>
                <Field full label={L(language, 'Description (EN)', 'الوصف (إنجليزي)')}><textarea rows="5" className={inputCls} value={f.description_en} onChange={(e) => upd('description_en', e.target.value)} /></Field>
                <Field full label={L(language, 'Description (AR)', 'الوصف (عربي)')}><textarea rows="5" dir="rtl" className={inputCls} value={f.description_ar} onChange={(e) => upd('description_ar', e.target.value)} /></Field>
            </div>
        </Modal>
    );
}

export function ImagesModal({ row, onSave, onClose }) {
    const { language } = useApp();
    const [imgs, setImgs] = useState(row.images || []);
    return (
        <Modal wide title={L(language, 'Product Images', 'صور المنتج')} onClose={onClose} onSave={() => { onSave({ images: imgs }); onClose(); }}>
            <ImageUploader images={imgs} onChange={setImgs} />
        </Modal>
    );
}

export function CompatibilityModal({ row, refs, onSave, onClose }) {
    const { language } = useApp();
    const [cars, setCars] = useState(row.compatible_cars || []);
    // Which product's cars these are, so a popup opened from the wrong row is caught.
    const name = ((language === 'ar' ? row.title_ar || row.title_en : row.title_en || row.title_ar) || '').trim();
    return (
        <Modal wide title={L(language, 'Vehicle Compatibility', 'توافق المركبات')}
            subtitle={name && `${L(language, 'Product', 'المنتج')}: ${name}`} onClose={onClose} onSave={() => { onSave({ compatible_cars: cars, is_universal: false }); onClose(); }}>
            <CompatibilityBuilder compatibleCars={cars} setCompatibleCars={setCars} carBrands={refs?.metadata?.carBrands || []} />
        </Modal>
    );
}

export function VariationsModal({ row, onSave, onClose }) {
    const { language } = useApp();
    const [vt, setVt] = useState(row.variation_types || []);
    const [vr, setVr] = useState(row.variants || []);
    return (
        <Modal wide title={L(language, 'Options', 'الخيارات')} onClose={onClose} onSave={() => { onSave({ variation_types: vt, variants: vr }); onClose(); }}>
            <VariationBuilder
                language={language}
                variationTypes={vt}
                variants={vr}
                stockManagement={row.stock_management}
                basePrice={row.price}
                baseDiscountType={row.discount_type}
                baseDiscountValue={row.discount_value}
                onChange={({ variation_types, variants }) => { setVt(variation_types); setVr(variants); }}
            />
        </Modal>
    );
}

export function ShippingModal({ row, onSave, onClose }) {
    const { language } = useApp();
    const isAr = language === 'ar';
    const [local, setLocal] = useState({
        weight: row.weight ?? '',
        dimensions: row.dimensions || { length: '', width: '', height: '' },
        shipping_class_id: row.shipping_class_id || '',
    });
    return (
        <Modal wide title={L(language, 'Shipping', 'الشحن')} onClose={onClose}
            onSave={() => { onSave({ weight: local.weight, dimensions: local.dimensions, shipping_class_id: local.shipping_class_id }); onClose(); }}>
            <ProductShippingFields form={local} setForm={setLocal} isAr={isAr} />
        </Modal>
    );
}
