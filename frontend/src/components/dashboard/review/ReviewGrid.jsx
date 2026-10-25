'use client';

import { memo, useState } from 'react';
import { CheckCircle2, Loader2, PanelRightOpen, Save } from 'lucide-react';
import { adminApi } from '../../../lib/api';
import { PART_TYPES } from '../../../lib/partType';
import { thumbUrl, resolveAssetUrl } from '../../../lib/assets';
import { issueLabel } from '../../../lib/productReview';

const CELL = 'w-full min-w-0 bg-transparent border border-transparent hover:border-zinc-200 focus:border-marine-cyan focus:bg-white dark:focus:bg-[#0E1012] rounded-md px-2 py-1.5 text-xs outline-none dark:text-white';

/** One editable line. Defined at file level: a row made inside the table would lose its inputs on every keystroke. */
const GridRow = memo(function GridRow({ row, draft, selected, flatCategories, isAr, onToggle, onEdit, onOpen }) {
  const value = (key) => (draft && key in draft ? draft[key] : row[key]);
  const categoryId = draft && 'category_id' in draft ? draft.category_id : (row.category?._id || '');
  const universal = draft && 'is_universal' in draft ? draft.is_universal : row.is_universal;
  return (
    <tr className={`border-b border-zinc-100 dark:border-white/5 ${draft ? 'bg-amber-50/60 dark:bg-amber-500/5' : ''}`}>
      <td className="px-2 py-1.5"><input type="checkbox" checked={selected} onChange={() => onToggle(row._id)} className="w-4 h-4 accent-marine-cyan" /></td>
      <td className="px-1 py-1.5">
        {row.image
          ? <img src={thumbUrl(resolveAssetUrl(row.image), 160)} alt="" className="w-10 h-10 rounded-md object-cover" />
          : <div className="w-10 h-10 rounded-md bg-zinc-100 dark:bg-white/5" />}
      </td>
      <td className="px-1 py-1.5 min-w-[180px]"><input dir="rtl" value={value('title_ar') || ''} onChange={(e) => onEdit(row._id, { title_ar: e.target.value })} className={CELL} /></td>
      <td className="px-1 py-1.5 min-w-[160px]"><input dir="ltr" value={value('title_en') || ''} onChange={(e) => onEdit(row._id, { title_en: e.target.value })} className={CELL} /></td>
      <td className="px-1 py-1.5 w-24"><input type="number" min="0" dir="ltr" value={value('price') ?? ''} onChange={(e) => onEdit(row._id, { price: e.target.value })} className={CELL} /></td>
      <td className="px-1 py-1.5 min-w-[150px]">
        <select value={categoryId} onChange={(e) => onEdit(row._id, { category_id: e.target.value })} className={CELL}>
          <option value="">{isAr ? '— من غير فئة —' : '— no category —'}</option>
          {flatCategories.map((c) => <option key={c._id} value={c._id}>{'  '.repeat(c.level)}{isAr ? (c.name_ar || c.name) : c.name}</option>)}
        </select>
      </td>
      <td className="px-1 py-1.5 w-28">
        <select value={value('part_type') || ''} onChange={(e) => onEdit(row._id, { part_type: e.target.value })} className={CELL}>
          <option value="">—</option>
          {PART_TYPES.map((t) => <option key={t.value} value={t.value}>{isAr ? t.ar : t.en}</option>)}
        </select>
      </td>
      <td className="px-2 py-1.5 text-center">
        {/* Turning "universal" on is one click; choosing cars needs the panel. */}
        <input type="checkbox" checked={universal} disabled={universal && !(draft && 'is_universal' in draft)}
          onChange={(e) => onEdit(row._id, { is_universal: e.target.checked })}
          title={universal ? (isAr ? 'لتحديد عربيات افتح اللوحة' : 'Open the panel to choose cars') : (isAr ? 'خليه عام' : 'Make it universal')}
          className="w-4 h-4 accent-marine-cyan" />
      </td>
      <td className="px-2 py-1.5">
        <div className="flex flex-wrap gap-1 max-w-[200px]">
          {row.issues.map((code) => <span key={code} className="rounded-full bg-amber-100 dark:bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold text-amber-800 dark:text-amber-300">{issueLabel(code, isAr)}</span>)}
        </div>
      </td>
      <td className="px-2 py-1.5">
        <button type="button" onClick={() => onOpen(row._id)} title={isAr ? 'فتح اللوحة' : 'Open the panel'} className="p-1.5 rounded-md text-zinc-500 hover:text-marine-primary hover:bg-red-50 dark:hover:bg-red-500/10"><PanelRightOpen size={15} /></button>
      </td>
    </tr>
  );
});

/** A payload for the admin update route from a row's edits. */
const payloadOf = (draft) => {
  const out = { ...draft };
  if ('price' in out) out.price = Number(out.price);
  if ('is_universal' in out && out.is_universal) out.compatible_cars = [];
  return out;
};

/**
 * The review as a sheet: edit titles, price, category, part type and "universal" straight
 * in the rows, then save — or save and publish — every edited row at once.
 */
export default function ReviewGrid({ rows, selected, onToggle, onToggleAll, flatCategories, isAr, onOpen, onDone }) {
  const [drafts, setDrafts] = useState({});
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const edited = Object.keys(drafts);

  const onEdit = (id, patch) => setDrafts((d) => ({ ...d, [id]: { ...(d[id] || {}), ...patch } }));

  const saveAll = async (publish) => {
    const bad = edited.find((id) => 'price' in drafts[id] && !(Number(drafts[id].price) > 0));
    if (bad) { setError(isAr ? 'فيه سعر غلط في صف من الصفوف المعدّلة.' : 'An edited row has an invalid price.'); return; }
    setBusy(publish ? 'publish' : 'save');
    setError('');
    const failed = [];
    const ok = [];
    for (let i = 0; i < edited.length; i += 4) {
      await Promise.all(edited.slice(i, i + 4).map((id) => adminApi.updateProduct(id, payloadOf(drafts[id]))
        .then(() => ok.push(id))
        .catch((err) => failed.push(`${rows.find((r) => r._id === id)?.title_ar || id}: ${err.message}`))));
    }
    try {
      if (publish && ok.length) await adminApi.approveProducts(ok);
    } catch (err) {
      failed.push(err.message);
    }
    setDrafts((d) => Object.fromEntries(Object.entries(d).filter(([id]) => !ok.includes(id))));
    setBusy('');
    if (failed.length) setError(failed.join(' · '));
    onDone(ok, publish);
  };

  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r._id));

  return (
    <div className="bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/5 rounded-2xl overflow-hidden">
      {error && <div className="m-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-600 p-3 text-xs font-bold">{error}</div>}
      <div className="overflow-x-auto">
        <table className="w-full text-start">
          <thead>
            <tr className="text-[11px] text-zinc-400 uppercase tracking-wider border-b border-zinc-100 dark:border-white/5 bg-zinc-50 dark:bg-white/[0.02]">
              <th className="px-2 py-2"><input type="checkbox" checked={allChecked} onChange={onToggleAll} className="w-4 h-4 accent-marine-cyan" /></th>
              <th className="px-1 py-2" />
              <th className="px-2 py-2 text-start font-bold">{isAr ? 'العنوان بالعربي' : 'Arabic title'}</th>
              <th className="px-2 py-2 text-start font-bold">{isAr ? 'بالإنجليزي' : 'English title'}</th>
              <th className="px-2 py-2 text-start font-bold">{isAr ? 'السعر' : 'Price'}</th>
              <th className="px-2 py-2 text-start font-bold">{isAr ? 'الفئة' : 'Category'}</th>
              <th className="px-2 py-2 text-start font-bold">{isAr ? 'النوع' : 'Part type'}</th>
              <th className="px-2 py-2 font-bold">{isAr ? 'عام' : 'Universal'}</th>
              <th className="px-2 py-2 text-start font-bold">{isAr ? 'المشاكل' : 'Issues'}</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <GridRow key={row._id} row={row} draft={drafts[row._id]} selected={selected.has(row._id)} flatCategories={flatCategories}
                isAr={isAr} onToggle={onToggle} onEdit={onEdit} onOpen={onOpen} />
            ))}
          </tbody>
        </table>
      </div>
      {edited.length > 0 && (
        <div className="sticky bottom-0 flex flex-wrap items-center gap-2 border-t border-zinc-100 dark:border-white/5 bg-white/95 dark:bg-[#14171A]/95 p-3">
          <span className="text-sm font-bold text-amber-700 dark:text-amber-300 me-auto">{isAr ? `${edited.length} صف متعدّل` : `${edited.length} edited row(s)`}</span>
          <button type="button" onClick={() => setDrafts({})} disabled={!!busy} className="px-3 py-2 rounded-xl text-xs font-bold text-zinc-500 hover:text-red-500">{isAr ? 'تجاهل التعديلات' : 'Discard'}</button>
          <button type="button" onClick={() => saveAll(false)} disabled={!!busy} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-zinc-200 dark:border-white/10 text-xs font-bold text-zinc-700 dark:text-zinc-300 disabled:opacity-40">
            {busy === 'save' ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}{isAr ? 'حفظ' : 'Save'}
          </button>
          <button type="button" onClick={() => saveAll(true)} disabled={!!busy} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold disabled:opacity-50">
            {busy === 'publish' ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}{isAr ? 'حفظ ونشر المعدّل' : 'Save and publish the edited'}
          </button>
        </div>
      )}
    </div>
  );
}
