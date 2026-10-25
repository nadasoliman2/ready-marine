'use client';

import { useCallback, useRef, useState } from 'react';
import { BookOpen, Search, Menu, ChevronDown } from 'lucide-react';
import NotificationBell from './NotificationBell';
import { useApp } from '../../context/AppContext';
import { vendorEducationLabel } from '../vendor/VendorEducationModal';
import ThemeToggle from '../ThemeToggle';
import useDismiss from '../../lib/useDismiss';

function LanguagePicker() {
  const { language, setLanguage } = useApp();
  const [isOpen, setIsOpen] = useState(false);
  const boxRef = useRef(null);
  const close = useCallback(() => setIsOpen(false), []);
  // Opens on a click and stays open until a language is picked or the press lands elsewhere.
  // It used to open on hover and close on leaving: the gap between the button and the list
  // closed it on the way to "English", and a click on the hover-opened button closed it too.
  useDismiss(boxRef, isOpen, close);

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
        className="flex items-center gap-1.5 text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white px-3 py-1.5 text-xs font-bold transition-all border border-zinc-100 dark:border-white/5 hover:bg-zinc-50 dark:hover:bg-white/5 rounded-lg"
      >
        <span>{language === 'en' ? 'EN' : 'AR'}</span>
        <ChevronDown size={12} className={`transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      {isOpen && (
        <div className="absolute top-full end-0 mt-1 w-24 bg-white dark:bg-[#09090b] rounded-lg shadow-xl py-1 z-50 border border-zinc-100 dark:border-white/10 overflow-hidden">
          <button 
            onClick={() => { setLanguage('en'); setIsOpen(false); }} 
            className={`w-full text-start px-3 py-2 text-xs font-bold hover:bg-zinc-50 dark:hover:bg-white/10 transition-colors ${language === 'en' ? 'text-marine-primary bg-red-50 dark:bg-white/5' : 'text-zinc-600 dark:text-zinc-300'}`}
          >
            English
          </button>
          <button 
            onClick={() => { setLanguage('ar'); setIsOpen(false); }} 
            className={`w-full text-start px-3 py-2 text-xs font-bold hover:bg-zinc-50 dark:hover:bg-white/10 transition-colors ${language === 'ar' ? 'text-marine-primary bg-red-50 dark:bg-white/5' : 'text-zinc-600 dark:text-zinc-300'}`}
          >
            العربية
          </button>
        </div>
      )}
    </div>
  );
}

export default function TopBar({ onMenuClick, onEducationClick }) {
  const { user, t, language } = useApp();
  const isAdmin = user?.role === 'admin';
  const isVendor = user?.role === 'vendor';
  const isAr = language === 'ar';

  return (
    <header className="h-16 flex-shrink-0 bg-white dark:bg-[#14171A] border-b border-zinc-200 dark:border-white/5 flex items-center justify-between px-6 z-10">
      
      {/* Mobile Menu Trigger & Search */}
      <div className="flex items-center gap-4 flex-1">
        <button 
          onClick={onMenuClick}
          className="lg:hidden p-2 -ml-2 text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-white hover:bg-zinc-50 dark:hover:bg-white/5 rounded-lg transition-colors"
        >
          <Menu size={20} />
        </button>
        
        {!isAdmin && (
          <div className="max-w-md w-full relative hidden sm:block">
            <Search size={16} className="absolute start-3 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input 
              type="text" 
              placeholder={t.searchPrompt || "Search products, orders..."}
              className="w-full bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 text-zinc-900 dark:text-white rounded-lg ps-9 pe-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-marine-cyan/50 focus:border-marine-cyan transition-all"
            />
          </div>
        )}
      </div>

      {/* Right Side Icons */}
      <div className="flex items-center gap-3">
        <ThemeToggle />
        {isVendor && onEducationClick && (
          <button
            type="button"
            onClick={onEducationClick}
            className="inline-flex items-center gap-2 rounded-xl bg-marine-cyan px-2.5 py-2 text-xs font-black text-white shadow-sm shadow-red-500/20 transition-all hover:bg-marine-cyan-dark sm:px-3"
            aria-label={vendorEducationLabel(isAr)}
          >
            <BookOpen size={16} />
            <span className="hidden xl:inline">{vendorEducationLabel(isAr)}</span>
            <span className="hidden sm:inline xl:hidden">{isAr ? 'فيديوهات' : 'Videos'}</span>
          </button>
        )}
        <LanguagePicker />
        {!isAdmin && <NotificationBell />}
        
        <div className="h-6 w-px bg-zinc-200 dark:bg-white/10" />
        
        <div className="flex items-center gap-3">
          <div className={`${isAr ? 'text-left' : 'text-right'} hidden sm:block`}>
            <p className="text-sm font-bold text-zinc-900 dark:text-white leading-tight">{user?.store_name || user?.name || user?.username}</p>
            <p className="text-[10px] uppercase font-black tracking-widest text-marine-primary">
              {user?.role === 'admin' ? (t.admin || 'Admin') : (t.vendor || 'Vendor')}
            </p>
          </div>
          <div className="w-9 h-9 rounded-xl bg-marine-cyan flex items-center justify-center text-white font-black text-sm shadow-md">
            {(user?.store_name || user?.name || user?.username || 'U').charAt(0).toUpperCase()}
          </div>
        </div>
      </div>

    </header>
  );
}
