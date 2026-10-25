'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';

export default function Pagination({ pagination, setFilters, language, t }) {
  if (!pagination || pagination.pages <= 1) return null;

  const { page, pages } = pagination;
  const isAr = language === 'ar';

  const handlePageChange = (newPage) => {
    if (newPage >= 1 && newPage <= pages) {
      setFilters(prev => ({ ...prev, page: newPage }));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const renderPageNumbers = () => {
    const numbers = [];
    const maxVisible = 5;
    
    let start = Math.max(1, page - 2);
    let end = Math.min(pages, start + maxVisible - 1);
    
    if (end - start < maxVisible - 1) {
      start = Math.max(1, end - maxVisible + 1);
    }

    for (let i = start; i <= end; i++) {
      numbers.push(
        <button
          key={i}
          onClick={() => handlePageChange(i)}
          className={`w-10 h-10 rounded-xl font-bold transition-all ${
            page === i
              ? 'bg-marine-cyan text-white shadow-lg shadow-marine-cyan/20'
              : 'bg-white border border-marine-teal/15 text-marine-muted hover:border-marine-cyan hover:text-marine-primary'
          }`}
        >
          {i}
        </button>
      );
    }
    return numbers;
  };

  return (
    <div className="flex items-center justify-center gap-2 py-8 mt-12" dir={isAr ? 'rtl' : 'ltr'}>
      <button
        onClick={() => handlePageChange(page - 1)}
        disabled={page === 1}
        className="p-2 bg-white border border-marine-teal/15 rounded-xl text-marine-outline hover:text-marine-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        <ChevronLeft className={isAr ? 'rotate-180' : ''} />
      </button>

      <div className="flex items-center gap-2">
        {renderPageNumbers()}
      </div>

      <button
        onClick={() => handlePageChange(page + 1)}
        disabled={page === pages}
        className="p-2 bg-white border border-marine-teal/15 rounded-xl text-marine-outline hover:text-marine-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        <ChevronRight className={isAr ? 'rotate-180' : ''} />
      </button>
    </div>
  );
}
