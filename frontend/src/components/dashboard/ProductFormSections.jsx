'use client';

import { Info } from 'lucide-react';
import NestedCategorySelector from './NestedCategorySelector';
import ImageUploader from './ImageUploader';
import CompatibilityBuilder from './CompatibilityBuilder';
import VariationBuilder from './VariationBuilder';
import ProductShippingFields from './ProductShippingFields';
import DiscountFields from './DiscountFields';
import PartTypePicker from './PartTypePicker';
import { useApp } from '../../context/AppContext';
import { useLinkedBrandCategory } from '../../lib/brandCategoryLink';
import SearchableSelect from '../SearchableSelect';
import { brandOptions } from '../../lib/pickerOptions';
import AudiencePicker from './AudiencePicker';

/**
 * The full product form, section by section.
 *
 * Shared by the two vendor add paths so they can never drift apart: the
 * from-scratch form renders every section, and the condensed catalog form
 * renders the pricing section on its own up top and hides the rest behind
 * "Edit the rest of the details" — same fields, same component.
 *
 * `only` / `except` pick which sections render. Sections are keyed:
 *   core · media · organization · pricing · shipping · variations · trunk · audiences · compatibility
 *
 * The required part type sits in "organization". A page that shows it elsewhere (the
 * condensed catalog form keeps it up top, beside price and stock) passes `hidePartType`.
 */

const inputCls = 'w-full bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm focus:border-marine-cyan focus:outline-none dark:text-white';

function Section({ title, hint, right, children, numbered }) {
    return (
        <section className="bg-white dark:bg-[#09090b] border border-zinc-200 dark:border-white/5 rounded-2xl overflow-hidden shadow-sm">
            <div className="px-6 py-4 border-b border-zinc-100 dark:border-white/5 bg-zinc-50 dark:bg-white/[0.02] flex items-center justify-between gap-4">
                <div>
                    <h3 className="font-bold text-zinc-900 dark:text-white">{numbered ? `${numbered}. ${title}` : title}</h3>
                    {hint && <p className="text-xs text-zinc-500 mt-0.5">{hint}</p>}
                </div>
                {right}
            </div>
            {children ? <div className="p-6">{children}</div> : null}
        </section>
    );
}

export default function ProductFormSections({
    form,
    setForm,
    metadata,
    only = null,
    except = null,
    numbered = true,
    hidePartType = false,
    partTypeInvalid = false,
}) {
    const { language, t, siteSettings } = useApp();
    const isAr = language === 'ar';

    // Brand and category narrow each other; changing one clears the other if it no longer fits.
    const linked = useLinkedBrandCategory({
        brands: metadata?.productBrands || [],
        categories: metadata?.categories || [],
        brandId: form?.product_brand_id || '',
        categoryId: form?.category_id || '',
        setBrandId: (id) => setForm(prev => ({ ...prev, product_brand_id: id })),
        setCategoryId: (id) => setForm(prev => ({ ...prev, category_id: id })),
    });

    const shows = (key) => {
        if (only) return only.includes(key);
        if (except) return !except.includes(key);
        return true;
    };
    // Numbering follows the order the sections actually render in, so a partial
    // form doesn't show "1, 4, 6".
    let counter = 0;
    const n = () => (numbered ? ++counter : null);

    return (
        <div className="space-y-6">

            {shows('core') && (
                <Section numbered={n()} title={isAr ? 'المعلومات الأساسية' : 'Core Information'}>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                        <div className="space-y-1"><label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">{t.titleEn || 'Title (EN)'}</label><input type="text" value={form.title_en} onChange={e => setForm({ ...form, title_en: e.target.value })} className={inputCls} /></div>
                        <div className="space-y-1"><label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">{t.titleAr || 'Title (AR)'}</label><input type="text" value={form.title_ar} onChange={e => setForm({ ...form, title_ar: e.target.value })} dir="rtl" className={inputCls} /></div>
                        <div className="space-y-1"><label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">{t.subtitleEn || 'Subtitle (EN)'}</label><input type="text" value={form.subtitle_en} onChange={e => setForm({ ...form, subtitle_en: e.target.value })} className={inputCls} /></div>
                        <div className="space-y-1"><label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">{t.subtitleAr || 'Subtitle (AR)'}</label><input type="text" value={form.subtitle_ar} onChange={e => setForm({ ...form, subtitle_ar: e.target.value })} dir="rtl" className={inputCls} /></div>
                        <div className="sm:col-span-2 space-y-1"><label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">{t.descriptionEn || 'Description (EN)'}</label><textarea rows="4" value={form.description_en} onChange={e => setForm({ ...form, description_en: e.target.value })} className={inputCls} /></div>
                        <div className="sm:col-span-2 space-y-1"><label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">{t.descriptionAr || 'Description (AR)'}</label><textarea rows="4" value={form.description_ar} onChange={e => setForm({ ...form, description_ar: e.target.value })} dir="rtl" className={inputCls} /></div>
                    </div>
                </Section>
            )}

            {shows('media') && (
                <Section numbered={n()} title={isAr ? 'صور المنتج' : 'Product Media'}>
                    <ImageUploader images={form.images} onChange={(imgs) => setForm({ ...form, images: imgs })} />
                </Section>
            )}

            {shows('organization') && (
                <Section numbered={n()} title={isAr ? 'التصنيف والرموز' : 'Organization & Codes'}>
                    {!hidePartType && (
                        <div className="mb-6">
                            <PartTypePicker value={form.part_type} onChange={(v) => setForm({ ...form, part_type: v })} isAr={isAr} invalid={partTypeInvalid} />
                        </div>
                    )}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <div className="space-y-4">
                            <div className="space-y-1">
                                <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">{t.manufacturerBrand || 'Manufacturer Brand'}</label>
                                <SearchableSelect value={form.product_brand_id} onChange={(v) => setForm({ ...form, product_brand_id: v })} options={brandOptions(linked.brands)} placeholder={t.allBrands || 'Select Brand'} isAr={language === 'ar'} buttonClassName={`${inputCls} pe-9`} />
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">{t.productCategory || 'Category'}</label>
                                <NestedCategorySelector categories={metadata?.categories || []} allowedIds={linked.allowedCategoryIds} initialValue={form.category_id} onChange={(leafId) => setForm({ ...form, category_id: leafId })} />
                            </div>
                        </div>
                        <div className="space-y-4 md:border-s border-zinc-100 dark:border-white/5 md:ps-8">
                            <div className="space-y-1"><label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">SKU</label><input type="text" value={form.sku} onChange={e => setForm({ ...form, sku: e.target.value })} className={inputCls} /></div>
                            <div className="space-y-1"><label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">{t.partNumberMpn || 'Part Number (MPN)'}</label><input type="text" value={form.part_number} onChange={e => setForm({ ...form, part_number: e.target.value })} className={inputCls} /></div>
                        </div>
                    </div>
                </Section>
            )}

            {shows('pricing') && (
                <Section
                    numbered={n()}
                    title={isAr ? 'التسعير والمخزون' : 'Pricing & Inventory'}
                    right={
                        <label className="flex items-center gap-2 cursor-pointer text-sm text-zinc-700 dark:text-zinc-300 font-semibold">
                            <input type="checkbox" checked={form.stock_management} onChange={e => setForm({ ...form, stock_management: e.target.checked })} className="text-marine-primary rounded focus:ring-marine-cyan" />
                            <span>{isAr ? 'تتبع المخزون' : 'Track Stock'}</span>
                        </label>
                    }
                >
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                        <div className="space-y-1">
                            <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">{t.regularPrice || 'Regular Price'}</label>
                            <div className="relative"><span className="absolute start-3 top-1/2 -translate-y-1/2 text-zinc-500 text-sm">{siteSettings?.currency || 'QAR'}</span><input type="number" min="0" step="0.01" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} className="w-full bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 rounded-lg ps-12 pe-3 py-2 text-sm focus:border-marine-cyan focus:outline-none dark:text-white" /></div>
                        </div>
                        <DiscountFields form={form} setForm={setForm} isAr={isAr} />
                        <div className="space-y-1">
                            <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">{t.stockQuantity || 'Stock Quantity'}</label>
                            {form.variation_types.length > 0 && form.variation_types.some(vt => vt.options?.length > 0 || vt.name) ? (
                                <div className="flex items-center gap-2 py-2 px-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-lg">
                                    <span className="text-xs text-red-600 dark:text-red-400 font-medium">
                                        {isAr ? 'يُدار المخزون من خلال الخيارات أدناه' : 'Stock is managed per variant below'}
                                    </span>
                                </div>
                            ) : (
                                <input type="number" min="0" value={form.quantity} disabled={!form.stock_management} onChange={e => setForm({ ...form, quantity: e.target.value })} className="w-full bg-zinc-50 dark:bg-[#0E1012] disabled:opacity-50 border border-zinc-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm focus:border-marine-cyan focus:outline-none dark:text-white" />
                            )}
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">{isAr ? 'حالة المخزون' : 'Stock Status'}</label>
                            <select
                                value={form.stock_status}
                                disabled={!form.stock_management}
                                onChange={e => setForm({ ...form, stock_status: e.target.value })}
                                className="w-full bg-zinc-50 dark:bg-[#0E1012] disabled:opacity-50 border border-zinc-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm focus:border-marine-cyan focus:outline-none dark:text-white transition-colors"
                            >
                                <option value="instock">{isAr ? 'متوفر' : 'In Stock'}</option>
                                <option value="outofstock">{isAr ? 'نفذ المخزون' : 'Out of Stock'}</option>
                                <option value="onbackorder">{isAr ? 'طلب مسبق (Backorder)' : 'On Backorder'}</option>
                            </select>
                        </div>
                    </div>
                </Section>
            )}

            {shows('shipping') && <ProductShippingFields form={form} setForm={setForm} isAr={isAr} />}

            {shows('variations') && (
                <Section
                    numbered={n()}
                    title={isAr ? 'الخيارات (الألوان، المقاسات...)' : 'Options (Color, Size…)'}
                    hint={isAr ? 'أنشئ خيارات للمنتج مع تسعير وكميات مستقلة لكل تنويع.' : 'Build product options with independent pricing and stock per combination.'}
                >
                    <VariationBuilder
                        language={language}
                        variationTypes={form.variation_types}
                        variants={form.variants}
                        stockManagement={form.stock_management}
                        basePrice={form.price}
                        baseDiscountType={form.discount_type}
                        baseDiscountValue={form.discount_value}
                        onChange={({ variation_types, variants }) => setForm(f => ({ ...f, variation_types, variants }))}
                    />
                </Section>
            )}


            {shows('trunk') && (
                <Section
                    title={isAr ? 'مستلزمات على المركب' : 'Onboard Essentials'}
                    hint={t.forTrunkDesc || (isAr ? 'حدد المنتج ده كحاجة لازم تكون في كل عربية — هيظهر في صفحة شنطة العربية' : 'Mark this product as something every car should carry — it appears on the Car Trunk page')}
                    right={
                        <div className="flex items-center gap-3">
                            <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">{t.forTrunk || (isAr ? 'من أساسيات الشنطة' : 'Trunk essential')}</span>
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input type="checkbox" className="sr-only peer" checked={!!form.for_trunk} onChange={e => setForm({ ...form, for_trunk: e.target.checked })} />
                                <div className="w-11 h-6 bg-zinc-300 peer-focus:outline-none rounded-full peer dark:bg-white/10 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-zinc-600 peer-checked:bg-amber-500"></div>
                            </label>
                        </div>
                    }
                />
            )}

            {shows('audiences') && (
                <Section
                    title={isAr ? 'المجموعات المخصصة' : 'Audience Hubs'}
                    hint={isAr ? 'اختار المجموعات اللي المنتج يظهر فيها على الصفحة الرئيسية، بغض النظر عن القسم بتاعه.' : 'Pick the hubs this product appears in on the home page, whatever its category.'}
                >
                    <AudiencePicker value={form.target_audiences} onChange={(v) => setForm(prev => ({ ...prev, target_audiences: v }))} isAr={isAr} />
                </Section>
            )}

            {shows('compatibility') && (
                <Section
                    numbered={n()}
                    title={isAr ? 'توافق المركبات' : 'Vehicle Compatibility'}
                    hint={isAr ? 'حدد المركبات التي تناسب هذه القطعة.' : 'Define exactly which vehicles this part fits.'}
                    right={
                        <div className="flex items-center gap-3">
                            <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">{isAr ? 'قطعة عامة' : 'Set as Universal'}</span>
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input type="checkbox" className="sr-only peer" checked={form.is_universal} onChange={e => setForm({ ...form, is_universal: e.target.checked })} />
                                <div className="w-11 h-6 bg-zinc-300 peer-focus:outline-none rounded-full peer dark:bg-white/10 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-zinc-600 peer-checked:bg-marine-cyan"></div>
                            </label>
                        </div>
                    }
                >
                    {!form.is_universal ? (
                        <CompatibilityBuilder compatibleCars={form.compatible_cars} setCompatibleCars={(cars) => setForm({ ...form, compatible_cars: cars })} carBrands={metadata?.carBrands || []} />
                    ) : (
                        <div className="text-center py-8">
                            <div className="w-12 h-12 bg-marine-mist dark:bg-marine-cyan/10 text-marine-primary rounded-full flex items-center justify-center mx-auto mb-3"><Info size={24} /></div>
                            <h4 className="font-bold text-zinc-900 dark:text-white">{isAr ? 'هذه قطعة عامة' : 'This is a Universal Part'}</h4>
                            <p className="text-sm text-zinc-500 mt-1">{isAr ? 'تناسب جميع المركبات.' : 'It fits all vehicles. Toggle off "Set as Universal" to define specific models.'}</p>
                        </div>
                    )}
                </Section>
            )}
        </div>
    );
}

export { inputCls as productInputCls };
