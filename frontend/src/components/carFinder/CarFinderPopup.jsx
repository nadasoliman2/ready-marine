'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, CarFront, Search, X } from 'lucide-react';
import Overlay from '../Overlay';
import Link from '../LocaleLink';
import SearchableSelect from '../SearchableSelect';
import { useApp } from '../../context/AppContext';
import { garageCarLabel } from '../company/useGarageCars';
import useCarFinder from './useCarFinder';

// Closed (or used) once, it stays away this long: a welcome, not a wall on every visit.
const QUIET_FOR_MS = 7 * 24 * 60 * 60 * 1000;
const STORAGE_KEY = 'readycar.carFinderPopup.closedAt';
// Long enough for the page to show first, so the popup reads as an offer, not a block.
const SHOW_AFTER_MS = 1200;

const FIELD = 'bg-zinc-50 border border-zinc-200 rounded-2xl ps-4 pe-10 py-3.5 text-[15px] font-semibold text-zinc-900 hover:border-zinc-300 focus:outline-none focus:border-marine-cyan focus:bg-white transition-colors';

const recentlyClosed = () => {
  try {
    const at = Number(window.localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(at) && at > 0 && Date.now() - at < QUIET_FOR_MS;
  } catch {
    return false;
  }
};

const rememberClosed = () => {
  try { window.localStorage.setItem(STORAGE_KEY, String(Date.now())); } catch { /* private mode */ }
};

/** The open popup: the form, its data loaded only now that it is on screen. */
function PopupCard({ close, isAr, t }) {
  const {
    metadata, filters, garageCars, brandModels, selectedModel, openNext, searchButtonRef,
    handleBrandChange, handleModelChange, handleYearChange, handleGarageCarChange,
    dropQueued, handleSearch,
  } = useCarFinder({ onSearch: close, withType: false });

  useEffect(() => {
    // Escape closes it — unless a dropdown inside took the key to close itself first.
    const onKey = (event) => { if (event.key === 'Escape' && !event.defaultPrevented) close(); };
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener('keydown', onKey);
    };
  }, [close]);

  const field = (props) => <SearchableSelect isAr={isAr} buttonClassName={FIELD} onOpen={dropQueued} {...props} />;

  return (
    <Overlay className="fixed inset-0 z-[150] flex items-end sm:items-center justify-center p-3 sm:p-6" dir={isAr ? 'rtl' : 'ltr'}>
      <button
        type="button"
        aria-label={isAr ? 'إغلاق' : 'Close'}
        onClick={close}
        className="absolute inset-0 bg-zinc-950/40 backdrop-blur-[2px] animate-in fade-in duration-300"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="car-finder-popup-title"
        className="relative w-full max-w-md bg-white rounded-[28px] shadow-[0_30px_80px_rgba(0,0,0,0.25)] overflow-hidden animate-in fade-in slide-in-from-bottom-4 sm:zoom-in-95 duration-300"
      >
        <button
          type="button"
          onClick={close}
          aria-label={isAr ? 'إغلاق' : 'Close'}
          className="absolute top-4 end-4 z-10 w-9 h-9 rounded-full bg-white/80 hover:bg-white text-zinc-500 hover:text-zinc-900 flex items-center justify-center shadow-sm transition-colors"
        >
          <X size={18} />
        </button>

        <div className="bg-gradient-to-b from-red-50 via-red-50/40 to-white px-6 pt-7 pb-4">
          <span className="w-12 h-12 rounded-2xl bg-marine-cyan text-white flex items-center justify-center shadow-lg shadow-red-600/20 mb-4">
            <CarFront size={24} />
          </span>
          <h2 id="car-finder-popup-title" className="text-xl font-black text-zinc-900 leading-snug pe-10">
            {isAr ? 'لاقي قطع غيار عربيتك في ثواني' : 'Find the right parts for your car'}
          </h2>
          <p className="text-sm text-zinc-500 mt-1.5">
            {isAr ? 'اختار عربيتك ونعرضلك القطع اللي تناسبها بس.' : 'Pick your car and we will show only the parts that fit it.'}
          </p>
        </div>

        <div className="px-6 pb-6 space-y-3">
          {garageCars.length > 0 && field({
            value: filters.garage_car_id,
            onChange: handleGarageCarChange,
            options: garageCars.map(car => ({ value: car._id, label: garageCarLabel(car, isAr) })),
            placeholder: isAr ? 'اختار من جراجي' : 'Choose from my garage',
          })}

          {field({
            value: filters.car_brand_id,
            onChange: handleBrandChange,
            options: metadata?.carBrands?.map(b => ({ value: b._id, label: b.name, keywords: (b.name_aliases || []).join(' '), image: b.image })) || [],
            placeholder: t.selectBrand,
          })}
          {field({
            value: filters.car_model_id,
            onChange: handleModelChange,
            options: brandModels.map(m => ({ value: m._id, label: m.name })),
            placeholder: t.selectModel,
            disabled: !filters.car_brand_id,
            autoOpen: openNext === 'model',
          })}
          {/* The car is all this asks: make, model, year. */}
          {field({
            value: filters.car_year,
            onChange: handleYearChange,
            options: selectedModel?.years?.map(y => ({ value: y.year, label: y.year })) || [],
            placeholder: t.selectYear,
            disabled: !filters.car_model_id,
            autoOpen: openNext === 'year',
          })}

          <button
            ref={searchButtonRef}
            type="button"
            onClick={handleSearch}
            className="w-full flex items-center justify-center gap-2 bg-marine-cyan hover:bg-marine-cyan-dark text-white font-bold py-3.5 rounded-2xl transition-colors shadow-lg shadow-red-600/20"
          >
            <Search size={18} />
            <span>{isAr ? 'اعرض القطع المناسبة' : 'Show matching parts'}</span>
            <ArrowRight size={16} className="rtl:rotate-180" />
          </button>

          <Link href="/products" onClick={close} className="block text-center text-sm font-bold text-zinc-500 hover:text-marine-primary pt-1">
            {isAr ? 'أو تصفح كل المنتجات' : 'Or browse all products'}
          </Link>
        </div>
      </div>
    </Overlay>
  );
}

/**
 * The welcome popup on the home page: the hero's "find parts for your car" form, lighter.
 * Shown once, a moment after the page opens; closing it (X, the dimmed page, Escape) or
 * searching keeps it away for a week. Not for staff accounts, which do not shop.
 */
export default function CarFinderPopup() {
  const { language, t, user, isMounted } = useApp();
  const [open, setOpen] = useState(false);
  const isStaff = user?.role === 'vendor' || user?.role === 'admin';

  const close = useCallback(() => {
    rememberClosed();
    setOpen(false);
  }, []);

  useEffect(() => {
    if (!isMounted || isStaff || recentlyClosed()) return undefined;
    const id = setTimeout(() => setOpen(true), SHOW_AFTER_MS);
    return () => clearTimeout(id);
  }, [isMounted, isStaff]);

  return open ? <PopupCard close={close} isAr={language === 'ar'} t={t} /> : null;
}
