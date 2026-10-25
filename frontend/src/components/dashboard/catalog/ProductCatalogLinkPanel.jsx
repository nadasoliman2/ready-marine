'use client';

import { useCallback, useEffect, useState } from 'react';
import { Library, ImageOff, Link2Off, Link2, Search, Loader2, ExternalLink, ImageDown, Tag, Wand2 } from 'lucide-react';
import Link from '../../LocaleLink';
import { adminCatalogApi } from '../../../lib/api';
import { L, entryTitle, entryImage, entryCategoryName, entryBrandName } from '../../../lib/catalog';
import CatalogSinglePickerModal from './CatalogSinglePickerModal';
import MatchSuggestions from './MatchSuggestions';

/**
 * The catalog link, shown during ADMIN product review only.
 *
 * This is the one place the link is visible and changeable, and it is here for a
 * single scenario: a vendor picked "oil filter" and edited it into a brake kit.
 * Nothing unlinks automatically — the reviewer sees the entry beside the
 * vendor's data and decides. The vendor never sees any of this.
 *
 * An unlinked product shows the catalog matcher's proposals, each one press from linked.
 */
export default function ProductCatalogLinkPanel({ product, language, onChanged }) {
    const [picking, setPicking] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');

    // Populated by the admin product endpoint; a bare id means an entry that no
    // longer resolves, which reads the same as "not linked" for review purposes.
    const entry = product.catalog_entry_id && typeof product.catalog_entry_id === 'object'
        ? product.catalog_entry_id
        : null;

    // The entries an unlinked product most likely is.
    const [matches, setMatches] = useState(null);
    useEffect(() => {
        if (entry) { setMatches(null); return undefined; }
        let alive = true;
        adminCatalogApi.matchProduct(product._id)
            .then((res) => { if (alive) setMatches(res.matches || []); })
            .catch(() => { if (alive) setMatches([]); });
        return () => { alive = false; };
    }, [product._id, entry]);

    // The reviewer is an admin, so the picker reads the admin list endpoint
    // rather than the vendor-scoped search.
    const adminSearch = useCallback(
        (term, filters) => adminCatalogApi.list({ status: 'all', q: term, limit: 24, ...filters }),
        [],
    );

    const relink = async (entryId) => {
        setBusy(true);
        setError('');
        setNotice('');
        try {
            await adminCatalogApi.relinkProduct(product._id, entryId);
            await onChanged?.();
        } catch (err) {
            setError(err.message || L(language, 'Could not change the link.', 'تعذر تغيير الربط.'));
        } finally {
            setBusy(false);
        }
    };

    // Two things worth copying from the entry onto the product: its curated images and
    // its brand. Each is one press, additive, and re-reads the product afterwards.
    const entryImages = (entry?.images || []).filter((img) => img?.url);
    const entryHasBrand = !!(entry?.product_brand_id?._id || entry?.product_brand_id);

    const importImages = async () => {
        setBusy(true);
        setError('');
        setNotice('');
        try {
            const res = await adminCatalogApi.importProductImagesFromEntry(product._id);
            await onChanged?.();
            setNotice(res.added > 0
                ? L(language, `${res.added} image(s) imported from the catalog; the catalog picture is now the primary one.`, `تم استيراد ${res.added} صورة من الكاتالوج، وصورة الكاتالوج بقت الأساسية.`)
                : L(language, 'The product already had every catalog image; the catalog picture is now the primary one.', 'المنتج كان فيه كل صور الكاتالوج بالفعل، وصورة الكاتالوج بقت الأساسية.'));
        } catch (err) {
            setError(err.message || L(language, 'Could not import the images.', 'تعذر استيراد الصور.'));
        } finally {
            setBusy(false);
        }
    };

    const importBrand = async () => {
        setBusy(true);
        setError('');
        setNotice('');
        try {
            const res = await adminCatalogApi.importProductBrandFromEntry(product._id);
            await onChanged?.();
            setNotice(res.changed
                ? L(language, 'Brand imported from the catalog.', 'تم استيراد البراند من الكاتالوج.')
                : L(language, 'The product already carries the catalog brand.', 'المنتج عليه براند الكاتالوج بالفعل.'));
        } catch (err) {
            setError(err.message || L(language, 'Could not import the brand.', 'تعذر استيراد البراند.'));
        } finally {
            setBusy(false);
        }
    };

    return (
        <section className="mt-6 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-white/5 dark:bg-[#14171A]">
            <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
                <div>
                    <h2 className="text-lg font-black text-zinc-900 dark:text-white flex items-center gap-2">
                        <Library size={17} className="text-zinc-400" />
                        {L(language, 'Catalog link', 'ربط الكتالوج')}
                    </h2>
                    <p className="mt-1 text-xs text-zinc-500 max-w-xl">
                        {L(language,
                            'Which catalog entry this product counts towards. Analytics only — changing it does not touch the product, and the vendor is not told.',
                            'البطاقة التي يُحتسب هذا المنتج ضمنها. للتحليلات فقط — تغييرها لا يمسّ المنتج ولا يُبلَّغ التاجر بها.')}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        disabled={busy}
                        onClick={() => setPicking(true)}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-300 hover:border-marine-cyan hover:text-marine-primary disabled:opacity-50"
                    >
                        <Search size={13} /> {entry ? L(language, 'Change link', 'تغيير الربط') : L(language, 'Link an entry', 'ربط ببطاقة')}
                    </button>
                    {entry && (
                        <button
                            type="button"
                            disabled={busy}
                            onClick={() => relink(null)}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-300 hover:border-red-500 hover:text-red-500 disabled:opacity-50"
                        >
                            {busy ? <Loader2 size={13} className="animate-spin" /> : <Link2Off size={13} />}
                            {L(language, 'Unlink', 'إلغاء الربط')}
                        </button>
                    )}
                    {entry && (
                        <button
                            type="button"
                            disabled={busy || entryImages.length === 0}
                            onClick={importImages}
                            title={entryImages.length === 0 ? L(language, 'The catalog entry has no images', 'بطاقة الكاتالوج مفيهاش صور') : undefined}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-300 hover:border-marine-cyan hover:text-marine-primary disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <ImageDown size={13} /> {L(language, 'Import image from catalog', 'استيراد الصورة من الكاتالوج')}
                        </button>
                    )}
                    {entry && (
                        <button
                            type="button"
                            disabled={busy || !entryHasBrand}
                            onClick={importBrand}
                            title={!entryHasBrand ? L(language, 'The catalog entry has no brand', 'بطاقة الكاتالوج مفيهاش براند') : undefined}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-300 hover:border-marine-cyan hover:text-marine-primary disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <Tag size={13} /> {L(language, 'Import brand from catalog', 'استيراد البراند من الكاتالوج')}
                        </button>
                    )}
                </div>
            </div>

            {error && <p className="mb-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
            {notice && <p className="mb-3 text-sm text-emerald-600 dark:text-emerald-400">{notice}</p>}

            {entry ? (
                <div className="flex items-center gap-4 rounded-xl bg-zinc-50 dark:bg-white/[0.03] p-3">
                    <div className="w-14 h-14 rounded-lg bg-zinc-100 dark:bg-white/5 flex items-center justify-center overflow-hidden flex-shrink-0">
                        {entryImage(entry)
                            ? <img src={entryImage(entry)} alt="" className="w-full h-full object-cover" />
                            : <ImageOff size={16} className="text-zinc-400" />}
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="font-bold text-sm text-zinc-900 dark:text-white truncate">{entryTitle(entry, language)}</p>
                        <p className="text-xs text-zinc-500 truncate">
                            {[entryCategoryName(entry, language), entryBrandName(entry), entry.part_number].filter(Boolean).join(' · ')}
                        </p>
                    </div>
                    <Link
                        href={`/admin/dashboard/catalog/${entry._id}`}
                        className="flex items-center gap-1.5 text-xs font-bold text-marine-primary hover:underline flex-shrink-0"
                    >
                        {L(language, 'Open entry', 'فتح البطاقة')} <ExternalLink size={12} />
                    </Link>
                </div>
            ) : (
                <>
                    <p className="text-sm text-zinc-500">
                        {L(language,
                            'Not linked to any catalog entry — this product sits outside catalog analytics.',
                            'غير مرتبط بأي بطاقة كتالوج — هذا المنتج خارج تحليلات الكتالوج.')}
                    </p>
                    {(matches == null || matches.length > 0) && (
                        <div className="mt-4">
                            <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 mb-2 flex items-center gap-1">
                                <Wand2 size={11} /> {L(language, 'Suggested catalog entries', 'بطاقات مقترحة للربط')}
                            </p>
                            <MatchSuggestions
                                matches={matches}
                                language={language}
                                busy={busy}
                                actionLabel={L(language, 'Link', 'اربط')}
                                actionIcon={Link2}
                                onPick={(picked) => relink(String(picked._id))}
                            />
                        </div>
                    )}
                </>
            )}

            {picking && (
                <CatalogSinglePickerModal
                    language={language}
                    title={L(language, 'Link this product to…', 'اربط هذا المنتج بـ…')}
                    searchFn={adminSearch}
                    facetsFn={(params) => adminCatalogApi.filters('', params)}
                    onPick={(picked) => relink(String(picked._id))}
                    onClose={() => setPicking(false)}
                />
            )}
        </section>
    );
}
