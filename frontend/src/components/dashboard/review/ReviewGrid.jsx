'use client';

import { memo } from 'react';
import { PanelRightOpen, Store } from 'lucide-react';
import { PART_TYPES } from '../../../lib/partType';
import { thumbUrl, resolveAssetUrl } from '../../../lib/assets';
import { issueLabel } from '../../../lib/productReview';
import useRowLink from '../../../lib/useRowLink';

/** One table line. Clicks open the full edit page for this product. */
const GridRow = memo(function GridRow({ row, selected, isAr, onToggle, onOpen, rowLink }) {
  const partTypeObj = PART_TYPES.find((t) => t.value === row.part_type);
  const partTypeLabel = partTypeObj ? (isAr ? partTypeObj.ar : partTypeObj.en) : (row.part_type || '—');
  const catName = isAr
    ? (row.category?.name_ar || row.category?.name)
    : (row.category?.name || row.category?.name_ar);

  return (
    <tr
      {...rowLink(`/admin/dashboard/products/${row._id}?edit=1&from=pending`)}
      className="border-b border-zinc-100 dark:border-white/5 hover:bg-zinc-50 dark:hover:bg-white/[0.03] transition-colors cursor-pointer group"
    >
      <td className="px-2 py-2.5" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggle(row._id)}
          className="w-4 h-4 accent-marine-cyan"
        />
      </td>
      <td className="px-1 py-2.5">
        {row.image ? (
          <img
            src={thumbUrl(resolveAssetUrl(row.image), 160)}
            alt=""
            className="w-10 h-10 rounded-md object-cover"
          />
        ) : (
          <div className="w-10 h-10 rounded-md bg-zinc-100 dark:bg-white/5" />
        )}
      </td>
      <td className="px-2 py-2.5 min-w-[180px] max-w-[240px]">
        <span
          dir="rtl"
          className="block text-xs font-bold text-zinc-900 dark:text-white truncate group-hover:text-marine-primary transition-colors"
          title={row.title_ar || ''}
        >
          {row.title_ar || '—'}
        </span>
      </td>
      <td className="px-2 py-2.5 min-w-[160px] max-w-[220px]">
        <span
          dir="ltr"
          className="block text-xs text-zinc-700 dark:text-zinc-300 truncate"
          title={row.title_en || ''}
        >
          {row.title_en || '—'}
        </span>
      </td>
      <td className="px-2 py-2.5 whitespace-nowrap">
        <span className="text-xs font-bold text-zinc-900 dark:text-white" dir="ltr">
          {row.price != null ? row.price : '—'}
        </span>
      </td>
      <td className="px-2 py-2.5 min-w-[130px] max-w-[180px]">
        <span
          className="block text-xs text-zinc-600 dark:text-zinc-400 truncate"
          title={catName || ''}
        >
          {catName || (isAr ? '— من غير فئة —' : '— no category —')}
        </span>
      </td>
      <td className="px-2 py-2.5 whitespace-nowrap">
        <span className="text-xs text-zinc-600 dark:text-zinc-400">
          {partTypeLabel}
        </span>
      </td>
      <td className="px-2 py-2.5 min-w-[130px] max-w-[180px]">
        <div
          className="flex items-center gap-1.5 text-xs font-bold text-zinc-700 dark:text-zinc-200 truncate"
          title={row.vendor?.store_name || row.vendor?.store_username || ''}
        >
          <Store size={13} className="text-marine-primary shrink-0" />
          <span className="truncate">
            {row.vendor?.store_name || row.vendor?.store_username || '—'}
          </span>
        </div>
      </td>
      <td className="px-2 py-2.5">
        <div className="flex flex-wrap gap-1 max-w-[200px]">
          {row.issues && row.issues.length > 0 ? (
            row.issues.map((code) => (
              <span
                key={code}
                className="rounded-full bg-amber-100 dark:bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold text-amber-800 dark:text-amber-300"
              >
                {issueLabel(code, isAr)}
              </span>
            ))
          ) : (
            <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-bold">
              {isAr ? 'جاهز للنشر' : 'Ready'}
            </span>
          )}
        </div>
      </td>
      <td className="px-2 py-2.5 text-end" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={() => onOpen(row._id)}
          title={isAr ? 'فتح اللوحة الجانبية' : 'Open the side panel'}
          className="p-1.5 rounded-md text-zinc-400 hover:text-marine-primary hover:bg-zinc-100 dark:hover:bg-white/10 transition-colors"
        >
          <PanelRightOpen size={15} />
        </button>
      </td>
    </tr>
  );
});

export default function ReviewGrid({ rows, selected, onToggle, onToggleAll, isAr, onOpen }) {
  const rowLink = useRowLink();
  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r._id));

  return (
    <div className="bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/5 rounded-2xl overflow-hidden shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-start">
          <thead>
            <tr className="text-[11px] text-zinc-400 uppercase tracking-wider border-b border-zinc-100 dark:border-white/5 bg-zinc-50 dark:bg-white/[0.02]">
              <th className="px-2 py-2.5"><input type="checkbox" checked={allChecked} onChange={onToggleAll} className="w-4 h-4 accent-marine-cyan" /></th>
              <th className="px-1 py-2.5" />
              <th className="px-2 py-2.5 text-start font-bold">{isAr ? 'العنوان بالعربي' : 'Arabic title'}</th>
              <th className="px-2 py-2.5 text-start font-bold">{isAr ? 'بالإنجليزي' : 'English title'}</th>
              <th className="px-2 py-2.5 text-start font-bold">{isAr ? 'السعر' : 'Price'}</th>
              <th className="px-2 py-2.5 text-start font-bold">{isAr ? 'الفئة' : 'Category'}</th>
              <th className="px-2 py-2.5 text-start font-bold">{isAr ? 'النوع' : 'Part type'}</th>
              <th className="px-2 py-2.5 text-start font-bold">{isAr ? 'التاجر' : 'Vendor'}</th>
              <th className="px-2 py-2.5 text-start font-bold">{isAr ? 'المشاكل' : 'Issues'}</th>
              <th className="px-2 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <GridRow
                key={row._id}
                row={row}
                selected={selected.has(row._id)}
                isAr={isAr}
                onToggle={onToggle}
                onOpen={onOpen}
                rowLink={rowLink}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
