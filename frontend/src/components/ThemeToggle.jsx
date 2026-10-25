'use client';

import { Moon, Sun } from 'lucide-react';
import { useApp } from '../context/AppContext';

/**
 * The light / dark switch. One component for every bar on the site, so the store, the
 * vendor dashboard, the admin and the company portal all flip the same saved setting.
 *
 * `tone` only styles the button for the bar it sits on: 'onDark' for the store's black top
 * bar, 'default' for the dashboards' top bars.
 */
export default function ThemeToggle({ tone = 'default', className = '' }) {
  const { theme, toggleTheme, language } = useApp();
  const isAr = language === 'ar';
  const dark = theme === 'dark';
  const label = dark
    ? (isAr ? 'الوضع الفاتح' : 'Light mode')
    : (isAr ? 'الوضع الليلي' : 'Dark mode');

  const tones = {
    onDark: 'text-zinc-300 hover:text-white hover:bg-white/10',
    default: 'text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:text-white dark:hover:bg-white/10',
  };

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={label}
      title={label}
      className={`inline-flex items-center justify-center w-8 h-8 rounded-lg transition-colors ${tones[tone] || tones.default} ${className}`}
    >
      {dark ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}
