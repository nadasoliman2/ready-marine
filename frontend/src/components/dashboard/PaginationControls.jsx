'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { PAGE_SIZE_OPTIONS } from '../../lib/usePageSize';

export default function PaginationControls({
  page,
  pageSize,
  total,
  onPageChange,
  // Optional: pass it and the rows-per-page selector appears. A table that has no
  // meaningful size choice simply omits it and keeps the bar it had.
  onPageSizeChange = null,
  labels = {},
  // 'top' for a second bar above the table: the line goes under it instead of over it.
  placement = 'bottom',
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(total, page * pageSize);
  const canPrev = page > 1;
  const canNext = page < totalPages;

  const goToPage = (nextPage) => {
    onPageChange(Math.min(totalPages, Math.max(1, nextPage)));
  };

  return (
    <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3 ${placement === 'top' ? 'border-b' : 'border-t'} border-zinc-100 dark:border-white/5 bg-white dark:bg-[#14171A]`}>
      <div className="flex items-center gap-3 flex-wrap">
        <p className="text-xs font-bold text-zinc-500">
          {labels.showing || 'Showing'} {start}-{end} {labels.of || 'of'} {total}
        </p>
        {onPageSizeChange && (
          <label className="flex items-center gap-1.5 text-xs font-bold text-zinc-500">
            <span className="hidden sm:inline">{labels.rowsPerPage || 'Rows'}</span>
            <select
              value={pageSize}
              // Changing the size moves the window, so the old page number can point past
              // the end of the results. The caller resets to page 1.
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              className="bg-transparent border border-zinc-200 dark:border-white/10 rounded-lg px-2 py-1 text-xs font-bold text-zinc-700 dark:text-zinc-200 focus:border-marine-cyan focus:outline-none cursor-pointer"
            >
              {PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n} className="dark:bg-[#14171A]">{n}</option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => goToPage(page - 1)}
          disabled={!canPrev}
          className="h-9 w-9 inline-flex items-center justify-center rounded-lg border border-zinc-200 dark:border-white/10 text-zinc-500 hover:text-marine-primary hover:border-marine-cyan/40 disabled:opacity-40 disabled:hover:text-zinc-500 disabled:hover:border-zinc-200 dark:disabled:hover:border-white/10"
          aria-label={labels.previous || 'Previous page'}
        >
          <ChevronLeft size={17} />
        </button>
        <span className="min-w-[92px] text-center text-xs font-black text-zinc-700 dark:text-zinc-300">
          {page} / {totalPages}
        </span>
        <button
          type="button"
          onClick={() => goToPage(page + 1)}
          disabled={!canNext}
          className="h-9 w-9 inline-flex items-center justify-center rounded-lg border border-zinc-200 dark:border-white/10 text-zinc-500 hover:text-marine-primary hover:border-marine-cyan/40 disabled:opacity-40 disabled:hover:text-zinc-500 disabled:hover:border-zinc-200 dark:disabled:hover:border-white/10"
          aria-label={labels.next || 'Next page'}
        >
          <ChevronRight size={17} />
        </button>
      </div>
    </div>
  );
}

/**
 * The rows-per-page control on its own, for the screens that draw their own pagination bar
 * instead of using the component above. Same options and same behaviour, so the choice
 * looks and works identically wherever it appears.
 */
export function PageSizeSelect({ pageSize, onChange, label = 'Rows' }) {
  return (
    <label className="flex items-center gap-1.5 text-xs font-bold text-zinc-500">
      <span className="hidden sm:inline">{label}</span>
      <select
        value={pageSize}
        onChange={(e) => onChange(Number(e.target.value))}
        className="bg-transparent border border-zinc-200 dark:border-white/10 rounded-lg px-2 py-1 text-xs font-bold text-zinc-700 dark:text-zinc-200 focus:border-marine-cyan focus:outline-none cursor-pointer"
      >
        {PAGE_SIZE_OPTIONS.map((n) => (
          <option key={n} value={n} className="dark:bg-[#14171A]">{n}</option>
        ))}
      </select>
    </label>
  );
}
