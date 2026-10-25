'use client';

import { useEffect, useState } from 'react';
import { Truck } from 'lucide-react';
import { shippingApi } from '../../lib/api';

/**
 * Reusable "Shipping" section for the product add/edit forms.
 * `form` must hold `weight`, `dimensions` ({ length, width, height }) and `shipping_class_id`.
 */
export default function ProductShippingFields({ form, setForm, isAr }) {
    const [classes, setClasses] = useState([]);

    useEffect(() => {
        (async () => {
            try {
                const data = await shippingApi.getClasses();
                setClasses(data?.classes || []);
            } catch (e) { /* ignore */ }
        })();
    }, []);

    const dims = form.dimensions || {};
    const setDim = (key, val) => setForm({ ...form, dimensions: { ...dims, [key]: val } });
    const inputCls = 'w-full bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm focus:border-marine-cyan focus:outline-none dark:text-white';

    return (
        <section className="bg-white dark:bg-[#09090b] border border-zinc-200 dark:border-white/5 rounded-2xl overflow-hidden shadow-sm">
            <div className="px-6 py-4 border-b border-zinc-100 dark:border-white/5 bg-zinc-50 dark:bg-white/[0.02] flex items-center gap-2">
                <Truck size={16} className="text-marine-primary" />
                <h3 className="font-bold text-zinc-900 dark:text-white">{isAr ? 'الشحن' : 'Shipping'}</h3>
            </div>
            <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-1">
                    <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">{isAr ? 'الوزن (كجم)' : 'Weight (kg)'}</label>
                    <input type="number" min="0" step="any" value={form.weight ?? ''} onChange={(e) => setForm({ ...form, weight: e.target.value })} className={inputCls} placeholder={isAr ? 'موصى به للشحن حسب الوزن' : 'recommended — used for weight-based rates'} />
                </div>
                <div className="space-y-1">
                    <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">{isAr ? 'فئة الشحن' : 'Shipping Class'}</label>
                    <select value={form.shipping_class_id || ''} onChange={(e) => setForm({ ...form, shipping_class_id: e.target.value || null })} className={inputCls}>
                        <option value="">{isAr ? 'بدون فئة' : 'No class'}</option>
                        {classes.map((c) => <option key={c._id} value={c._id}>{isAr ? (c.name_ar || c.name) : c.name}</option>)}
                    </select>
                </div>
                <div className="md:col-span-2 grid grid-cols-3 gap-2 sm:gap-4">
                    <div className="space-y-1">
                        <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">{isAr ? 'الطول (سم)' : 'Length (cm)'}</label>
                        <input type="number" min="0" step="any" value={dims.length ?? ''} onChange={(e) => setDim('length', e.target.value)} className={inputCls} />
                    </div>
                    <div className="space-y-1">
                        <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">{isAr ? 'العرض (سم)' : 'Width (cm)'}</label>
                        <input type="number" min="0" step="any" value={dims.width ?? ''} onChange={(e) => setDim('width', e.target.value)} className={inputCls} />
                    </div>
                    <div className="space-y-1">
                        <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">{isAr ? 'الارتفاع (سم)' : 'Height (cm)'}</label>
                        <input type="number" min="0" step="any" value={dims.height ?? ''} onChange={(e) => setDim('height', e.target.value)} className={inputCls} />
                    </div>
                </div>
            </div>
        </section>
    );
}
