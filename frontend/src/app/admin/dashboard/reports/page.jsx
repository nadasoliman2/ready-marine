'use client';

import { useEffect, useMemo, useState } from 'react';
import { Car, Download, FileBarChart, Loader2, Search, ShoppingCart, Users, Package, Layers } from 'lucide-react';
import { adminApi, downloadFile } from '../../../../lib/api';
import { useApp } from '../../../../context/AppContext';
import PaginationControls from '../../../../components/dashboard/PaginationControls';
import usePageSize from '../../../../lib/usePageSize';
import SearchableSelect from '../../../../components/SearchableSelect';

const INPUT = 'bg-white dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 rounded-xl px-3 py-2 text-sm text-zinc-900 dark:text-white outline-none focus:border-marine-cyan';
const CARD = 'bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/5 rounded-2xl';
const TH = 'text-start font-bold px-4 py-3 whitespace-nowrap';
const TD = 'px-4 py-3 text-zinc-700 dark:text-zinc-300';

const TABS = [
  { id: 'carts', icon: ShoppingCart, ar: 'منتجات في السلة', en: 'Products in carts' },
  { id: 'cars', icon: Car, ar: 'عربيات العملاء', en: 'Customer cars' },
];

/** Typing settles for a moment before the report is asked again. */
function useDebounced(value, ms = 300) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return settled;
}

function Stat({ icon: Icon, label, value }) {
  return (
    <div className={`${CARD} p-4 flex items-center gap-3`}>
      <span className="w-10 h-10 rounded-xl bg-red-50 dark:bg-marine-cyan/10 text-marine-primary flex items-center justify-center shrink-0">
        <Icon size={18} />
      </span>
      <div className="min-w-0">
        <p className="text-xs font-bold text-zinc-500">{label}</p>
        <p className="text-xl font-black text-zinc-900 dark:text-white">{Number(value || 0).toLocaleString('en-US')}</p>
      </div>
    </div>
  );
}

function Phone({ value }) {
  return <span dir="ltr" className="whitespace-nowrap">{value || '—'}</span>;
}

function EmptyState({ isAr, loading, error }) {
  if (loading) {
    return <div className="py-16 flex justify-center"><Loader2 size={28} className="animate-spin text-marine-primary" /></div>;
  }
  return (
    <p className={`py-14 text-center text-sm font-bold ${error ? 'text-red-500' : 'text-zinc-400'}`}>
      {error || (isAr ? 'مفيش نتايج.' : 'Nothing to show.')}
    </p>
  );
}

/** Products in customers' carts: one row per cart line. */
function CartReport({ isAr, fmtDate }) {
  const [search, setSearch] = useState('');
  const [vendorId, setVendorId] = useState('');
  const settledSearch = useDebounced(search.trim());
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize('admin.reports.carts', 25);

  const params = useMemo(() => ({ search: settledSearch, vendor_id: vendorId }), [settledSearch, vendorId]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    adminApi.getCartReport(params)
      .then((data) => { if (active) { setReport(data); setPage(1); } })
      .catch((err) => { if (active) setError(err.message || (isAr ? 'تعذر تحميل التقرير.' : 'Could not load the report.')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [params, isAr]);

  const rows = report?.rows || [];
  const shown = rows.slice((page - 1) * pageSize, page * pageSize);

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
        <Stat icon={Package} label={isAr ? 'منتجات في السلال' : 'Cart lines'} value={report?.totals?.lines} />
        <Stat icon={Layers} label={isAr ? 'إجمالي الكمية' : 'Total quantity'} value={report?.totals?.quantity} />
        <Stat icon={Users} label={isAr ? 'عملاء عندهم سلة' : 'Customers with a cart'} value={report?.totals?.customers} />
      </div>

      <div className={`${CARD} p-3 mb-5 flex flex-wrap items-center gap-3`}>
        <div className="relative flex-1 min-w-[220px]">
          <Search size={16} className="absolute start-3 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={isAr ? 'ابحث بالمنتج أو اسم العميل أو التليفون أو الإيميل' : 'Search product, customer, phone or email'}
            className={`${INPUT} w-full ps-9`}
          />
        </div>
        <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} className={INPUT}>
          <option value="">{isAr ? 'كل التجار' : 'All vendors'}</option>
          {(report?.vendors || []).map((v) => <option key={v._id} value={v._id}>{v.name}</option>)}
        </select>
        <button
          type="button"
          onClick={() => downloadFile(adminApi.cartReportUrl(params))}
          className="flex items-center gap-2 bg-marine-cyan hover:bg-marine-cyan-dark text-white px-4 py-2 rounded-xl text-sm font-bold"
        >
          <Download size={16} /> {isAr ? 'تحميل Excel' : 'Download Excel'}
        </button>
      </div>

      <div className={`${CARD} overflow-hidden`}>
        {!rows.length ? <EmptyState isAr={isAr} loading={loading} error={error} /> : (
          <>
            <div className={`overflow-x-auto ${loading ? 'opacity-50' : ''}`}>
              <table className="w-full text-sm min-w-[980px]">
                <thead className="bg-zinc-50 dark:bg-white/[0.02] text-zinc-500 border-b border-zinc-200 dark:border-white/5">
                  <tr>
                    <th className={TH}>{isAr ? 'م' : '#'}</th>
                    <th className={TH}>{isAr ? 'اسم المنتج' : 'Product'}</th>
                    <th className={TH}>{isAr ? 'التاجر' : 'Vendor'}</th>
                    <th className={TH}>{isAr ? 'الكمية' : 'Qty'}</th>
                    <th className={TH}>{isAr ? 'اسم العميل' : 'Customer'}</th>
                    <th className={TH}>{isAr ? 'رقم التليفون' : 'Phone'}</th>
                    <th className={TH}>{isAr ? 'الإيميل' : 'Email'}</th>
                    <th className={TH}>{isAr ? 'المحافظة' : 'Governorate'}</th>
                    <th className={TH}>{isAr ? 'آخر تحديث للسلة' : 'Cart updated'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
                  {shown.map((r) => {
                    const title = (isAr ? r.product_title_ar : r.product_title_en) || (isAr ? 'منتج محذوف' : 'Deleted product');
                    return (
                      <tr key={`${r.user_id}-${r.serial}`}>
                        <td className={`${TD} text-zinc-400 font-bold`}>{r.serial}</td>
                        <td className={`${TD} font-bold text-zinc-900 dark:text-white max-w-[320px]`}>
                          {r.is_bundle && <span className="text-[10px] font-black text-purple-600 me-1">{isAr ? 'باقة' : 'Bundle'}</span>}
                          {title}
                          {r.variant && <span className="block text-xs font-medium text-zinc-500">{r.variant}</span>}
                        </td>
                        <td className={TD}>{r.vendor_name || '—'}</td>
                        <td className={`${TD} font-bold`}>{r.quantity}</td>
                        <td className={TD}>{r.customer_name}</td>
                        <td className={TD}><Phone value={r.phone} /></td>
                        <td className={TD}>{r.email || '—'}</td>
                        <td className={TD}>{(isAr ? r.governorate_ar : r.governorate_en) || '—'}</td>
                        <td className={`${TD} text-zinc-500 whitespace-nowrap`}>{fmtDate(r.cart_updated_at)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <PaginationControls
              page={page}
              pageSize={pageSize}
              total={rows.length}
              onPageChange={setPage}
              onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}
              labels={{ showing: isAr ? 'عرض' : 'Showing', of: isAr ? 'من' : 'of', previous: isAr ? 'السابق' : 'Previous', next: isAr ? 'التالي' : 'Next' }}
            />
          </>
        )}
      </div>
    </>
  );
}

/** Customers' cars, a section per make. */
function CarsReport({ isAr, fmtDate }) {
  const [search, setSearch] = useState('');
  const [brand, setBrand] = useState('');
  const settledSearch = useDebounced(search.trim());
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const params = useMemo(() => ({ search: settledSearch, brand }), [settledSearch, brand]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    adminApi.getCarsReport(params)
      .then((data) => { if (active) setReport(data); })
      .catch((err) => { if (active) setError(err.message || (isAr ? 'تعذر تحميل التقرير.' : 'Could not load the report.')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [params, isAr]);

  const groups = report?.groups || [];

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
        <Stat icon={Car} label={isAr ? 'عربيات متسجلة' : 'Cars'} value={report?.totals?.cars} />
        <Stat icon={Users} label={isAr ? 'عملاء' : 'Customers'} value={report?.totals?.customers} />
        <Stat icon={Layers} label={isAr ? 'ماركات' : 'Makes'} value={report?.totals?.brands} />
      </div>

      <div className={`${CARD} p-3 mb-5 flex flex-wrap items-center gap-3`}>
        <div className="relative flex-1 min-w-[220px]">
          <Search size={16} className="absolute start-3 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={isAr ? 'ابحث بالموديل أو السنة أو العميل أو التليفون أو الشركة' : 'Search model, year, customer, phone or company'}
            className={`${INPUT} w-full ps-9`}
          />
        </div>
        <SearchableSelect value={brand} onChange={setBrand} isAr={isAr} buttonClassName={`${INPUT} pe-9`}
          options={(report?.brands || []).map((b) => ({ value: b.name, label: `${b.name} (${b.count})`, image: b.image || null }))}
          placeholder={isAr ? 'كل الماركات' : 'All makes'} />
        <button
          type="button"
          onClick={() => downloadFile(adminApi.carsReportUrl(params))}
          className="flex items-center gap-2 bg-marine-cyan hover:bg-marine-cyan-dark text-white px-4 py-2 rounded-xl text-sm font-bold"
        >
          <Download size={16} /> {isAr ? 'تحميل Excel' : 'Download Excel'}
        </button>
      </div>

      {!groups.length ? <div className={CARD}><EmptyState isAr={isAr} loading={loading} error={error} /></div> : (
        <div className={`space-y-5 ${loading ? 'opacity-50' : ''}`}>
          {groups.map((group) => (
            <section key={group.brand} className={`${CARD} overflow-hidden`}>
              <header className="flex items-center justify-between gap-3 px-4 py-3 bg-zinc-50 dark:bg-white/[0.02] border-b border-zinc-200 dark:border-white/5">
                <h2 className="flex items-center gap-2 font-black text-zinc-900 dark:text-white">
                  <Car size={16} className="text-marine-primary" /> {group.brand || '—'}
                </h2>
                <span className="text-xs font-bold text-zinc-500">{group.count} {isAr ? 'عربية' : group.count === 1 ? 'car' : 'cars'}</span>
              </header>
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[980px]">
                  <thead className="text-zinc-500 border-b border-zinc-100 dark:border-white/5">
                    <tr>
                      <th className={TH}>{isAr ? 'الموديل' : 'Model'}</th>
                      <th className={TH}>{isAr ? 'السنة' : 'Year'}</th>
                      <th className={TH}>{isAr ? 'العميل' : 'Customer'}</th>
                      <th className={TH}>{isAr ? 'رقم التليفون' : 'Phone'}</th>
                      <th className={TH}>{isAr ? 'الإيميل' : 'Email'}</th>
                      <th className={TH}>{isAr ? 'المحافظة' : 'Governorate'}</th>
                      <th className={TH}>{isAr ? 'الشركة' : 'Company'}</th>
                      <th className={TH}>{isAr ? 'تاريخ التسجيل' : 'Signed up'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
                    {group.rows.map((r, i) => (
                      <tr key={`${r.user_id}-${i}`}>
                        <td className={`${TD} font-bold text-zinc-900 dark:text-white`}>{r.model}</td>
                        <td className={TD}>{r.year || '—'}</td>
                        <td className={TD}>{r.customer_name}</td>
                        <td className={TD}><Phone value={r.phone} /></td>
                        <td className={TD}>{r.email || '—'}</td>
                        <td className={TD}>{(isAr ? r.governorate_ar : r.governorate_en) || '—'}</td>
                        <td className={TD}>{r.company || '—'}</td>
                        <td className={`${TD} text-zinc-500 whitespace-nowrap`}>{fmtDate(r.registered_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}

/**
 * Customer reports: the products customers keep in their carts, and the cars in their
 * garages by make — each with an Excel download (Backend services/customerReportsService.js).
 */
export default function CustomerReportsPage({ searchParams }) {
  const { language } = useApp();
  const isAr = language === 'ar';
  const [tab, setTab] = useState(searchParams?.tab === 'cars' ? 'cars' : 'carts');
  const fmtDate = (d) => (d ? new Date(d).toLocaleDateString(isAr ? 'ar-EG' : 'en-GB', { year: 'numeric', month: 'short', day: 'numeric' }) : '—');

  return (
    <div className="animate-in fade-in duration-300" dir={isAr ? 'rtl' : 'ltr'}>
      <div className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-black text-zinc-900 dark:text-white">
          <FileBarChart size={24} className="text-marine-primary" />
          {isAr ? 'تقارير العملاء' : 'Customer Reports'}
        </h1>
        <p className="text-sm text-zinc-500 mt-1">
          {isAr
            ? 'اللي العملاء سايبينه في السلة، والعربيات اللي متسجلة في حساباتهم.'
            : 'What customers have left in their carts, and the cars saved in their accounts.'}
        </p>
      </div>

      <div className="flex gap-2 mb-5 border-b border-zinc-200 dark:border-white/5">
        {TABS.map(({ id, icon: Icon, ar, en }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-bold border-b-2 -mb-px transition-colors ${
              tab === id ? 'border-marine-cyan text-marine-primary' : 'border-transparent text-zinc-500 hover:text-zinc-900 dark:hover:text-white'
            }`}
          >
            <Icon size={16} /> {isAr ? ar : en}
          </button>
        ))}
      </div>

      {tab === 'carts'
        ? <CartReport isAr={isAr} fmtDate={fmtDate} />
        : <CarsReport isAr={isAr} fmtDate={fmtDate} />}

      {tab === 'carts' && (
        <p className="mt-4 text-xs text-zinc-400">
          {isAr
            ? 'السلال المحفوظة في حسابات العملاء بس — اللي بيتسوق من غير ما يسجل دخول سلته بتفضل على جهازه.'
            : 'Carts saved to customer accounts only — a shopper who is not signed in keeps theirs on their own device.'}
        </p>
      )}
    </div>
  );
}
