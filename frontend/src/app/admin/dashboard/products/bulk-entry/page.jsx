'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, FileSpreadsheet, Search, Loader2 } from 'lucide-react';
import Link from '../../../../../components/LocaleLink';
import { adminApi } from '../../../../../lib/api';
import { useApp } from '../../../../../context/AppContext';
import BulkEntryGrid from '../../../../../components/dashboard/bulk-entry/BulkEntryGrid';
import { L } from '../../../../../components/dashboard/bulk-entry/bulkEntryUtils';
import { searchOptions } from '../../../../../lib/searchSuggest';

function VendorSearchSelect({ vendors, selectedVendorId, onSelect, language }) {
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState('');
    const selected = vendors.find((v) => String(v._id) === String(selectedVendorId));

    // Best match first; each typed word has to start a word (lib/searchSuggest).
    const options = useMemo(
        () => searchOptions(vendors, search, (v) => [v.store_name, v.store_username, v.email, v.phone]),
        [vendors, search],
    );

    return (
        <div className="relative z-40" onBlur={() => setTimeout(() => setOpen(false), 120)}>
            <Search size={16} className="absolute start-3 top-1/2 -translate-y-1/2 text-zinc-400 z-10" />
            <input
                value={open ? search : (selected ? `${selected.store_name} (@${selected.store_username})` : search)}
                onFocus={() => setOpen(true)}
                onChange={(e) => { setSearch(e.target.value); setOpen(true); if (selectedVendorId) onSelect(''); }}
                placeholder={L(language, 'Select vendor by store, username, email, or phone', 'اختر البائع بالمتجر أو اسم المستخدم أو البريد أو الهاتف')}
                className="w-full bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 rounded-lg ps-9 pe-3 py-2 text-sm focus:border-marine-cyan focus:outline-none dark:text-white"
            />
            {open && (
                <div className="absolute z-50 mt-2 w-full max-h-72 overflow-y-auto rounded-xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#14171A] shadow-xl">
                    {options.map((v) => (
                        <button key={v._id} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { onSelect(v._id); setSearch(''); setOpen(false); }}
                            className={`w-full text-start px-4 py-3 hover:bg-red-50 dark:hover:bg-marine-cyan/10 border-t border-zinc-100 dark:border-white/5 ${String(selectedVendorId) === String(v._id) ? 'bg-red-50 dark:bg-marine-cyan/10' : ''}`}>
                            <p className="text-sm font-black text-zinc-900 dark:text-white">{v.store_name}</p>
                            <p className="text-xs text-zinc-500">@{v.store_username} · {v.email}</p>
                        </button>
                    ))}
                    {options.length === 0 && <div className="px-4 py-6 text-center text-sm font-bold text-zinc-500">{L(language, 'No vendors match', 'لا يوجد تجار مطابقون')}</div>}
                </div>
            )}
        </div>
    );
}

export default function AdminBulkEntryPage() {
    const { language } = useApp();
    const [vendors, setVendors] = useState([]);
    const [loadingVendors, setLoadingVendors] = useState(true);
    const [selectedVendorId, setSelectedVendorId] = useState('');

    useEffect(() => {
        (async () => {
            try {
                const data = await adminApi.getVendors();
                setVendors((data.vendors || []).filter((v) => v.status === 'active'));
            } catch (e) { /* ignore */ } finally { setLoadingVendors(false); }
        })();
    }, []);

    return (
        <div className="animate-in fade-in duration-300">
            <div className="flex items-center justify-between gap-3 mb-6 flex-wrap">
                <div className="flex items-center gap-3">
                    <Link href="/admin/dashboard/products" className="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-white/5 text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors">
                        <ArrowLeft size={20} />
                    </Link>
                    <div>
                        <h1 className="text-2xl font-bold text-zinc-900 dark:text-white tracking-tight">{L(language, 'Add products online', 'إضافة منتجات أونلاين')}</h1>
                        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">{L(language, 'Pick a vendor, fill the table, and submit many products at once.', 'اختر تاجراً، املأ الجدول، وأرسل عدة منتجات دفعة واحدة.')}</p>
                    </div>
                </div>
                <Link href="/admin/dashboard/products/bulk-upload" className="flex items-center gap-2 text-sm font-semibold text-zinc-600 dark:text-zinc-300 border border-zinc-200 dark:border-white/10 hover:border-marine-cyan hover:text-marine-primary px-3 py-2 rounded-lg transition-colors">
                    <FileSpreadsheet size={15} /> {L(language, 'Bulk Excel Upload', 'رفع جماعي بالإكسل')}
                </Link>
            </div>

            <div className="bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/5 rounded-2xl p-4 mb-4">
                <p className="text-sm font-semibold text-zinc-900 dark:text-white mb-2">{L(language, 'Choose vendor', 'اختر التاجر')}</p>
                {loadingVendors ? (
                    <div className="flex items-center gap-2 text-sm text-zinc-500"><Loader2 size={14} className="animate-spin" /> {L(language, 'Loading vendors…', 'جارٍ تحميل التجار…')}</div>
                ) : (
                    <VendorSearchSelect vendors={vendors} selectedVendorId={selectedVendorId} onSelect={setSelectedVendorId} language={language} />
                )}
            </div>

            <BulkEntryGrid
                submit={(products) => adminApi.bulkCreateProducts(selectedVendorId, products)}
                disabled={!selectedVendorId}
                disabledHint={L(language, 'Select a vendor above to start entering products.', 'اختر تاجراً بالأعلى لبدء إدخال المنتجات.')}
                storageKey={`bulk-entry:admin:${selectedVendorId || 'none'}`}
                editBase="/admin/dashboard/products"
                catalogPicker={false}
            />
        </div>
    );
}
