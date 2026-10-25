'use client';

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Loader2, Search, X } from 'lucide-react';
import Overlay from './Overlay';
import { highlightSegments, searchOptions } from '../lib/searchSuggest';
import BrandLogo from './BrandLogo';

// A list this long or longer gets a search box; a garage of two cars does not need one.
const SEARCH_FROM = 7;
const PHONE_WIDTH = 640;

/** The typed letters in red inside an option's label. */
function MarkedLabel({ text, query }) {
  return highlightSegments(text, query, { wordStart: true }).map((part, i) => (
    part.hit ? <mark key={i} className="bg-transparent text-marine-primary font-bold">{part.text}</mark> : <span key={i}>{part.text}</span>
  ));
}

/**
 * The open list: a search box (for long lists) and the options. On a phone it is a sheet
 * rising from the bottom over the dimmed page, with large rows; elsewhere it hangs under (or
 * over) the field.
 */
function OptionsPanel({
  listId, options, value, query, setQuery, active, setActive, onPick, onClose, onKeyDown, placeholder, isAr, anchor, phone, showSearch, withImages,
}) {
  const searchRef = useRef(null);
  const listRef = useRef(null);

  // The search box takes the keyboard at once on a desktop. Not on a phone: the on-screen
  // keyboard would cover half the list before anyone asked to type — most people scroll or
  // tap a name, and the box is right there for those who want to search.
  useEffect(() => { if (showSearch && !phone) searchRef.current?.focus({ preventScroll: true }); }, [showSearch, phone]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const list = (
    <ul ref={listRef} id={listId} role="listbox" className={`overflow-y-auto overscroll-contain flex-1 min-h-0 ${phone ? 'px-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]' : 'py-1'}`}>
      {value && !query && (
        <li>
          <button
            type="button"
            onClick={() => onPick('')}
            className={`w-full text-start text-zinc-400 hover:bg-zinc-50 dark:hover:bg-white/5 ${phone ? 'px-3 py-3.5 text-[15px] rounded-xl' : 'px-4 py-2.5 text-sm'}`}
          >
            {placeholder}
          </button>
        </li>
      )}
      {options.map((opt, i) => {
        const selected = String(opt.value) === String(value);
        return (
          <li key={opt.value}>
            <button
              type="button"
              role="option"
              aria-selected={selected}
              data-index={i}
              onClick={() => onPick(opt.value)}
              onMouseEnter={() => setActive(i)}
              className={phone
                // A phone: a finger-sized row, the logo in its own tile, the chosen one in red.
                ? `w-full flex items-center gap-3.5 px-3 py-3 rounded-xl text-start text-[15px] transition-colors active:bg-zinc-100 ${
                  selected ? 'bg-red-50 dark:bg-red-500/10 text-marine-primary font-bold' : 'text-zinc-800 dark:text-zinc-100 font-medium'
                }`
                : `w-full flex items-center gap-3 px-4 text-start text-sm transition-colors ${withImages ? 'py-2' : 'py-2.5'} ${
                  i === active ? 'bg-red-50 dark:bg-red-500/10 text-zinc-900 dark:text-white' : 'text-zinc-700 dark:text-zinc-200'
                } ${selected ? 'font-bold' : ''}`}
            >
              {withImages && (phone ? (
                <span className="w-11 h-11 shrink-0 rounded-xl bg-zinc-50 border border-zinc-100 flex items-center justify-center p-1.5">
                  <BrandLogo image={opt.image} name={opt.label} className="w-full h-full" />
                </span>
              ) : <BrandLogo image={opt.image} name={opt.label} />)}
              <span className="flex-1 min-w-0 line-clamp-2 break-words leading-snug"><MarkedLabel text={String(opt.label)} query={query} /></span>
              {selected && <Check size={phone ? 20 : 16} className="text-marine-primary shrink-0" />}
            </button>
          </li>
        );
      })}
      {!options.length && (
        <li className="px-4 py-6 text-center text-sm text-zinc-400">{isAr ? 'مفيش نتائج' : 'No matches'}</li>
      )}
    </ul>
  );

  const searchBox = showSearch && (
    <div className={phone ? 'px-4 pb-3' : 'p-2 border-b border-zinc-100 dark:border-white/10'}>
      <div className="relative">
        <Search size={16} className="absolute start-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
        <input
          ref={searchRef}
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setActive(0); }}
          onKeyDown={onKeyDown}
          placeholder={isAr ? 'ابحث…' : 'Search…'}
          autoComplete="off"
          aria-controls={listId}
          className={`w-full bg-zinc-100 dark:bg-white/5 ps-9 pe-3 text-base sm:text-sm text-zinc-900 dark:text-white placeholder-zinc-400 outline-none focus:bg-white dark:focus:bg-white/10 focus:ring-2 focus:ring-red-100 ${phone ? 'rounded-xl py-3' : 'rounded-lg py-2.5'}`}
        />
      </div>
    </div>
  );

  if (phone) {
    return (
      <Overlay className="fixed inset-0 z-[200] flex flex-col justify-end">
        <button type="button" aria-label={isAr ? 'إغلاق' : 'Close'} onClick={onClose} className="absolute inset-0 bg-black/50 animate-in fade-in duration-200" />
        <div className="relative flex flex-col bg-white dark:bg-[#1A1D20] rounded-t-3xl shadow-2xl h-[85dvh] animate-in slide-in-from-bottom duration-300">
          <div className="flex justify-center pt-2.5 pb-1" aria-hidden="true">
            <span className="w-10 h-1.5 rounded-full bg-zinc-200" />
          </div>
          <div className="flex items-center gap-3 px-5 pt-1 pb-3">
            <span className="flex-1 text-lg font-black text-zinc-900 dark:text-white truncate">{placeholder}</span>
            <button type="button" onClick={onClose} aria-label={isAr ? 'إغلاق' : 'Close'} className="w-9 h-9 rounded-full bg-zinc-100 text-zinc-600 flex items-center justify-center">
              <X size={18} />
            </button>
          </div>
          {searchBox}
          {list}
        </div>
      </Overlay>
    );
  }

  return (
    <Overlay
      data-searchable-select-panel=""
      className="fixed z-[200] flex flex-col bg-white dark:bg-[#1A1D20] border border-zinc-200 dark:border-white/10 rounded-xl shadow-[0_20px_50px_rgba(0,0,0,0.25)] overflow-hidden"
      style={anchor}
    >
      {searchBox}
      {list}
    </Overlay>
  );
}

/**
 * A dropdown with a search box inside it, for long lists (car makes, models, years,
 * categories). Same contract as a `<select>`: `value`, `onChange(value)`, `options` as
 * `{ value, label, keywords?, image? }` (`keywords`: more words the option answers to, such
 * as a car make's Arabic name; `image`: a small picture beside the label, such as the make's
 * logo), a `placeholder` that also clears the choice, `disabled`.
 *
 * Typing filters the options the way the site's search box matches words (Arabic letter
 * variants folded); options that start with what was typed come first.
 *
 * `buttonClassName`: the field's own look, replacing the shop's (a dashboard form draws its
 * fields its own way, dark mode included).
 *
 * `autoOpen`: open the list without a press — the field before this one was just filled in.
 * It opens once its options are there (a make's models are fetched when the make is picked)
 * and shows a spinner until then. `onOpen` is called whenever the list opens; the caller
 * drops `autoOpen` there.
 */
export default function SearchableSelect({
  value, onChange, options, placeholder, disabled = false, isAr = false, className = '', autoOpen = false, onOpen, buttonClassName = '',
}) {
  const listId = useId();
  const triggerRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [anchor, setAnchor] = useState(null);
  const [phone, setPhone] = useState(false);

  const selected = options.find((opt) => String(opt.value) === String(value));
  const showSearch = options.length >= SEARCH_FROM;
  const withImages = useMemo(() => options.some((opt) => opt.image), [options]);
  const waiting = autoOpen && !disabled && !open && options.length === 0;

  const shown = useMemo(
    () => searchOptions(options, query, (opt) => [String(opt.label), opt.keywords || '']),
    [options, query],
  );

  // Place the panel under the field, or over it when there is more room above.
  const place = () => {
    const box = triggerRef.current?.getBoundingClientRect();
    if (!box) return;
    const below = window.innerHeight - box.bottom - 12;
    const above = box.top - 12;
    const upward = below < 240 && above > below;
    const room = Math.max(160, Math.min(340, upward ? above : below));
    setAnchor({
      left: box.left,
      width: Math.max(box.width, 220),
      maxHeight: room,
      ...(upward ? { bottom: window.innerHeight - box.top + 6 } : { top: box.bottom + 6 }),
    });
  };

  const openPanel = () => {
    if (disabled) return;
    const isPhone = window.innerWidth < PHONE_WIDTH;
    setPhone(isPhone);
    if (!isPhone) place();
    setQuery('');
    const at = options.findIndex((opt) => String(opt.value) === String(value));
    setActive(at >= 0 ? at : 0);
    setOpen(true);
    onOpen?.();
  };

  // Asked to open by itself: once per ask, as soon as there is something to choose from. A
  // short list has no search box to take the keyboard, so the field itself does.
  const autoOpenedRef = useRef(false);
  useEffect(() => {
    if (!autoOpen) { autoOpenedRef.current = false; return; }
    if (autoOpenedRef.current || disabled || !options.length) return;
    autoOpenedRef.current = true;
    openPanel();
    if (!showSearch) triggerRef.current?.focus({ preventScroll: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpen, disabled, options.length]);

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus({ preventScroll: true });
  };

  const pick = (next) => {
    onChange(next);
    close();
  };

  // While open (desktop): follow the field when the page scrolls or resizes, and close on a
  // click anywhere else.
  useLayoutEffect(() => {
    if (!open || phone) return undefined;
    const onMove = () => place();
    const onDown = (event) => {
      if (triggerRef.current?.contains(event.target)) return;
      if (event.target.closest?.('[data-searchable-select-panel]')) return;
      close(false);
    };
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    document.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
      document.removeEventListener('mousedown', onDown);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, phone]);

  // A phone's list covers the page: keep the page behind it still.
  useEffect(() => {
    if (!open || !phone) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [open, phone]);

  // The list's keys, from the search box or — for a short list without one — the field.
  const onListKeyDown = (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!shown.length) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((current) => (current + step + shown.length) % shown.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (shown[active]) pick(shown[active].value);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  };

  const onTriggerKeyDown = (event) => {
    if (open) {
      if (event.key === ' ' && !showSearch) { event.preventDefault(); if (shown[active]) pick(shown[active].value); return; }
      onListKeyDown(event);
    } else if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openPanel();
    }
  };

  return (
    <div className={`relative flex-1 min-w-0 ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => (open ? close() : openPanel())}
        onKeyDown={onTriggerKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        className={buttonClassName
          ? `w-full h-full flex items-center gap-2 text-start cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${buttonClassName}`
          : `w-full h-full flex items-center gap-2 text-start bg-white/90 backdrop-blur-sm border border-zinc-200/70 rounded-xl ps-3 sm:ps-4 pe-8 sm:pe-9 py-3 sm:py-3.5 focus:outline-none focus:border-red-600/60 focus:bg-white transition-all text-sm cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed font-medium ${
            selected ? 'text-zinc-900' : 'text-zinc-500'
          } ${open ? 'border-red-600/60 bg-white' : ''}`}
      >
        {selected?.image && <BrandLogo image={selected.image} name={selected.label} className="w-5 h-5" />}
        {/* Two lines rather than a cut name ("Land Cruiser Prado", "Car Brand" in a narrow
            field). A form that sets its own look still shows the empty field's hint in grey. */}
        <span className={`flex-1 min-w-0 line-clamp-2 break-words leading-snug ${!selected && buttonClassName ? 'text-zinc-400' : ''}`}>
          {selected ? selected.label : placeholder}
        </span>
      </button>
      {waiting ? (
        // The spin animation sets `transform`, so the centring sits on a wrapper.
        <span className="absolute end-3 top-1/2 -translate-y-1/2 pointer-events-none">
          <Loader2 size={14} className="text-marine-primary animate-spin" />
        </span>
      ) : (
        <ChevronDown
          size={14}
          className={`absolute end-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none transition-transform ${open ? 'rotate-180' : ''}`}
        />
      )}
      {open && (phone || anchor) && (
        <OptionsPanel
          listId={listId}
          options={shown}
          value={value}
          query={query}
          setQuery={setQuery}
          active={active}
          setActive={setActive}
          onPick={pick}
          onClose={() => close()}
          onKeyDown={onListKeyDown}
          placeholder={placeholder}
          isAr={isAr}
          anchor={anchor}
          phone={phone}
          showSearch={showSearch}
          withImages={withImages}
        />
      )}
    </div>
  );
}
