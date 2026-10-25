'use client';

import { useRef } from 'react';
import { ArrowLeft, Check, ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * The category cards above the shop's grid. `title` names the level the cards belong to;
 * `back`, when given, is `{ label, onClick }` for the button that goes up one level.
 */
export default function SubcategorySlider({ subcategories, currentCategoryId, setFilters, language, title, back }) {
  const scrollRef = useRef(null);
  const isAr = language === 'ar';

  if (!subcategories || subcategories.length === 0) return null;

  const scroll = (direction) => {
    if (scrollRef.current) {
      const scrollAmount = 300;
      let actualDirection = direction;
      // Reverse scroll direction for RTL
      if (isAr) {
        actualDirection = direction === 'left' ? 'right' : 'left';
      }
      scrollRef.current.scrollBy({ left: actualDirection === 'left' ? -scrollAmount : scrollAmount, behavior: 'smooth' });
    }
  };

  return (
    <div className="mb-8 relative group">
      {back && (
        <button
          type="button"
          onClick={back.onClick}
          className="mb-3 mx-2 inline-flex max-w-[calc(100%-1rem)] items-center gap-2 rounded-full border border-marine-teal/15 bg-white px-3.5 py-1.5 text-sm font-bold text-marine-muted shadow-sm transition-colors hover:border-marine-cyan hover:text-marine-primary"
        >
          <ArrowLeft size={16} className="shrink-0 rtl:rotate-180" />
          <span className="truncate">{back.label}</span>
        </button>
      )}
      <div className="flex items-center justify-between gap-3 mb-4 px-2">
        <h3 className="text-lg font-bold text-marine-ink truncate">
          {title || (isAr ? 'التصنيفات الفرعية' : 'Subcategories')}
        </h3>
        <div className="flex gap-2 shrink-0">
          <button 
            onClick={() => scroll('left')} 
            className="p-2 rounded-full bg-white border border-marine-teal/15 shadow-sm text-marine-outline hover:text-marine-primary hover:border-marine-cyan transition-colors"
          >
            {isAr ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          </button>
          <button 
            onClick={() => scroll('right')} 
            className="p-2 rounded-full bg-white border border-marine-teal/15 shadow-sm text-marine-outline hover:text-marine-primary hover:border-marine-cyan transition-colors"
          >
            {isAr ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
          </button>
        </div>
      </div>

      <div 
        ref={scrollRef}
        className="flex gap-4 overflow-x-auto snap-x snap-mandatory scrollbar-hide pb-4 px-2"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {subcategories.map(cat => {
          const isSelected = String(currentCategoryId) === String(cat._id);

          return (
            <button
              type="button"
              key={cat._id}
              aria-pressed={isSelected}
              onClick={() => setFilters(prev => (
                String(prev.category_id) === String(cat._id)
                  ? prev
                  : { ...prev, category_id: cat._id, page: 1 }
              ))}
              className={`flex-none w-32 sm:w-40 text-start cursor-pointer snap-start transition-all duration-300 transform hover:-translate-y-1 ${
                isSelected ? 'opacity-100' : 'opacity-90 hover:opacity-100'
              }`}
            >
              <div className={`aspect-[4/3] rounded-lg overflow-hidden bg-marine-canvas border-2 transition-colors relative mb-3 ${
                isSelected ? 'border-marine-cyan shadow-md ring-4 ring-red-100' : 'border-transparent hover:border-marine-teal/15'
              }`}>
                {isSelected && (
                  <span className="absolute top-2 end-2 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-marine-cyan text-white shadow-lg shadow-marine-cyan/20">
                    <Check size={16} strokeWidth={3} />
                  </span>
                )}
                {cat.image ? (
                  <img 
                    src={cat.image.startsWith('http') ? cat.image : `${process.env.NEXT_PUBLIC_API_URL?.replace('/api', '') || 'http://localhost:4000'}${cat.image}`} 
                    alt={cat.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-marine-line">
                    <span className="text-xs font-medium">No Image</span>
                  </div>
                )}
              </div>
              <p className={`text-center text-sm font-bold truncate px-1 transition-colors ${
                isSelected ? 'text-marine-primary' : 'text-marine-muted'
              }`}>
                {isAr ? (cat.name_ar || cat.name) : cat.name}
              </p>
            </button>
          );
        })}
      </div>
      
      <style jsx>{`
        .scrollbar-hide::-webkit-scrollbar {
            display: none;
        }
      `}</style>
    </div>
  );
}
