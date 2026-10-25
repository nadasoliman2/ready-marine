'use client';

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useRouter } from '../../../../../lib/navigation';
import { adminApi, downloadFile } from '../../../../../lib/api';
import { searchOptions } from '../../../../../lib/searchSuggest';
import { useApp } from '../../../../../context/AppContext';
import {
  Upload, Download, FileSpreadsheet, CheckCircle2, XCircle,
  AlertTriangle, ArrowLeft, ChevronDown, ChevronUp, Loader2,
  ExternalLink, Search, Table2
} from 'lucide-react';

async function downloadErrorReport(failedRows) {
  const XLSX = (await import('xlsx')).default || (await import('xlsx'));

  const wsData = [['Row', 'SKU', 'Title', 'Saved as Draft?', 'Draft ID', 'Errors']];
  for (const row of failedRows) {
    wsData.push([
      row.row,
      row.sku || '',
      row.title || '',
      row.savedAsDraft ? 'YES' : 'NO',
      row.draftId || '',
      row.errors.map(e => `[${e.field}] ${e.message}`).join(' | '),
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(wsData);
  ws['!cols'] = [{ wch: 6 }, { wch: 20 }, { wch: 30 }, { wch: 16 }, { wch: 28 }, { wch: 80 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Errors');
  XLSX.writeFile(wb, 'bulk_upload_errors.xlsx');
}

function SuccessRow({ item, t }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg">
      <CheckCircle2 size={18} className="text-emerald-400 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <span className="font-semibold text-emerald-300 text-sm">{t.row} {item.row}</span>
        <span className="text-zinc-300 text-sm mx-2 truncate">{item.title || item.sku}</span>
      </div>
      <span className="text-xs text-zinc-500 font-mono truncate max-w-[180px]">{String(item._id)}</span>
    </div>
  );
}

function FailedRow({ item, router, t }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-red-500/30 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 bg-red-500/10 hover:bg-red-500/15 transition-colors text-start"
      >
        <XCircle size={18} className="text-red-400 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="font-semibold text-red-300 text-sm">{t.row} {item.row}</span>
          {item.sku && <span className="text-zinc-400 text-sm mx-2">SKU: {item.sku}</span>}
          {item.title && <span className="text-zinc-400 text-sm mx-2 truncate">— {item.title}</span>}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {item.savedAsDraft && (
            <span className="flex items-center gap-1 text-xs font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30 px-2 py-0.5 rounded-full">
              <AlertTriangle size={11} /> {t.draftSaved}
            </span>
          )}
          <span className="text-xs text-zinc-500">{item.errors.length} {item.errors.length !== 1 ? t.errorsWord : t.errorWord}</span>
          {open ? <ChevronUp size={16} className="text-zinc-400" /> : <ChevronDown size={16} className="text-zinc-400" />}
        </div>
      </button>

      {open && (
        <div className="px-4 py-3 bg-[#0E1012] space-y-2">
          {item.errors.map((err, i) => (
            <div key={i} className="flex gap-2 text-sm">
              <span className="font-mono text-xs bg-red-500/20 text-red-300 px-1.5 py-0.5 rounded flex-shrink-0">{err.field}</span>
              <span className="text-zinc-300">{err.message}</span>
            </div>
          ))}
          {item.savedAsDraft && item.draftId && (
            <button
              onClick={() => router.push(`/admin/dashboard/products/${item.draftId}/edit`)}
              className="mt-2 flex items-center gap-1.5 text-xs text-amber-400 hover:text-amber-300 font-medium transition-colors"
            >
              <ExternalLink size={13} /> {t.completeDraft}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function VendorSearchSelect({
  vendors,
  selectedVendorId,
  search,
  onSearchChange,
  onSelect,
  allVendors,
  t,
}) {
  const [open, setOpen] = useState(false);
  const selectedVendor = allVendors.find(vendor => String(vendor._id) === String(selectedVendorId));

  return (
    <div className="relative z-30" onBlur={() => setTimeout(() => setOpen(false), 120)}>
      <Search size={16} className="absolute start-3 top-1/2 -translate-y-1/2 text-zinc-400 z-10" />
      <input
        value={open ? search : (selectedVendor ? `${selectedVendor.store_name} (@${selectedVendor.store_username})` : search)}
        onFocus={() => setOpen(true)}
        onChange={e => {
          onSearchChange(e.target.value);
          setOpen(true);
          if (selectedVendorId) onSelect('');
        }}
        placeholder={t.vendorSearchPlaceholder}
        className="w-full bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 rounded-lg ps-9 pe-3 py-2 text-sm focus:border-marine-cyan focus:outline-none dark:text-white"
      />
      {open && (
        <div className="absolute z-50 mt-2 w-full max-h-72 overflow-y-auto rounded-xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#14171A] shadow-xl">
          {vendors.map(vendor => (
            <button
              key={vendor._id}
              type="button"
              onMouseDown={e => e.preventDefault()}
              onClick={() => {
                onSelect(vendor._id);
                onSearchChange('');
                setOpen(false);
              }}
              className={`w-full text-start px-4 py-3 hover:bg-red-50 dark:hover:bg-marine-cyan/10 border-t border-zinc-100 dark:border-white/5 ${String(selectedVendorId) === String(vendor._id) ? 'bg-red-50 dark:bg-marine-cyan/10' : ''}`}
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-black text-zinc-900 dark:text-white">{vendor.store_name}</p>
                  <p className="text-xs text-zinc-500">@{vendor.store_username} · {vendor.email}</p>
                </div>
                <span className="text-xs font-bold text-zinc-400" dir="ltr">{vendor.phone}</span>
              </div>
            </button>
          ))}
          {vendors.length === 0 && (
            <div className="px-4 py-6 text-center text-sm font-bold text-zinc-500">
              {t.noVendorsMatch}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function AdminBulkUploadPage() {
  const router = useRouter();
  const fileInputRef = useRef(null);
  const { t: tAll, language } = useApp();
  const t = tAll.bulk;

  const [dragging, setDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const [vendors, setVendors] = useState([]);
  const [vendorSearch, setVendorSearch] = useState('');
  const [selectedVendorId, setSelectedVendorId] = useState('');
  const [loadingVendors, setLoadingVendors] = useState(true);

  useEffect(() => {
    const loadVendors = async () => {
      try {
        const data = await adminApi.getVendors();
        setVendors((data.vendors || []).filter(v => v.status === 'active'));
      } catch (err) {
        setError(err.message || t.loadVendorsFailed);
      } finally {
        setLoadingVendors(false);
      }
    };
    loadVendors();
  }, []);

  // Best match first; each typed word has to start a word (lib/searchSuggest).
  const vendorOptions = useMemo(
    () => searchOptions(vendors, vendorSearch, (vendor) => [vendor.store_name, vendor.store_username, vendor.email, vendor.phone]),
    [vendors, vendorSearch],
  );

  const validateFile = (file) => {
    if (!file) return t.noFileSelected;
    if (!file.name.endsWith('.xlsx')) return t.onlyXlsx;
    if (file.size > 5 * 1024 * 1024) return t.fileTooLarge;
    return null;
  };

  const handleFileSelect = (file) => {
    const err = validateFile(file);
    if (err) { setError(err); setSelectedFile(null); return; }
    setError(null);
    setResult(null);
    setSelectedFile(file);
  };

  const onDragOver = useCallback((e) => { e.preventDefault(); setDragging(true); }, []);
  const onDragLeave = useCallback(() => setDragging(false), []);
  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFileSelect(file);
  }, []);

  const handleUpload = async () => {
    if (!selectedVendorId) {
      setError(t.selectVendorFirst);
      return;
    }
    if (!selectedFile) return;

    setUploading(true);
    setError(null);
    setResult(null);
    try {
      const data = await adminApi.bulkUploadProducts(selectedVendorId, selectedFile);
      setResult(data);
      setSelectedFile(null);
    } catch (err) {
      setError(err.message || t.uploadFailed);
    } finally {
      setUploading(false);
    }
  };

  // Opened as a link so the browser saves it itself — see downloadFile.
  const handleDownloadTemplate = () => downloadFile(adminApi.bulkTemplateUrl(language));

  const totalRows = (result?.succeeded?.length ?? 0) + (result?.failed?.length ?? 0);
  const hasDrafts = result?.failed?.some(f => f.savedAsDraft);

  return (
    <div className="h-full flex flex-col animate-in fade-in duration-300 max-w-4xl mx-auto">
      <div className="flex items-center justify-between gap-3 mb-6 flex-wrap">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push('/admin/dashboard/products')}
            className="p-2 rounded-lg hover:bg-white/5 transition-colors text-zinc-400 hover:text-white"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-white tracking-tight">{t.adminTitle}</h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">{t.adminSubtitle}</p>
          </div>
        </div>
        <button
          onClick={() => router.push('/admin/dashboard/products/bulk-entry')}
          className="flex items-center gap-2 text-sm font-semibold text-zinc-600 dark:text-zinc-300 border border-zinc-200 dark:border-white/10 hover:border-marine-cyan hover:text-marine-primary px-3 py-2 rounded-lg transition-colors"
        >
          <Table2 size={15} /> {language === 'ar' ? 'جرّب الرفع الجماعي أونلاين' : 'Prefer a guided table? Bulk Online Upload'}
        </button>
      </div>

      <div className="bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/5 rounded-2xl p-5 mb-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-8 h-8 rounded-full bg-marine-cyan text-white text-sm font-bold flex items-center justify-center flex-shrink-0">0</div>
          <div>
            <p className="font-semibold text-zinc-900 dark:text-white text-sm">{t.chooseVendor}</p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">{t.chooseVendorDesc}</p>
          </div>
        </div>
        {loadingVendors ? (
          <div className="flex items-center gap-2 text-sm text-zinc-500"><Loader2 size={14} className="animate-spin" /> {t.loadingVendors}</div>
        ) : (
          <VendorSearchSelect
            vendors={vendorOptions}
            selectedVendorId={selectedVendorId}
            search={vendorSearch}
            onSearchChange={setVendorSearch}
            onSelect={setSelectedVendorId}
            allVendors={vendors}
            t={t}
          />
        )}
      </div>

      <div className="bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/5 rounded-2xl p-5 mb-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-marine-cyan text-white text-sm font-bold flex items-center justify-center flex-shrink-0">1</div>
            <div>
              <p className="font-semibold text-zinc-900 dark:text-white text-sm">{t.step1Title}</p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">{t.step1DescAdmin}</p>
            </div>
          </div>
          <button
            onClick={handleDownloadTemplate}
            className="flex-shrink-0 flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
          >
            <Download size={16} />
            {t.download}
          </button>
        </div>
      </div>

      <div className="bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/5 rounded-2xl p-5 mb-4">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-8 h-8 rounded-full bg-marine-cyan text-white text-sm font-bold flex items-center justify-center flex-shrink-0">2</div>
          <div>
            <p className="font-semibold text-zinc-900 dark:text-white text-sm">{t.step2TitleAdmin}</p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">{t.step2DescAdmin}</p>
          </div>
        </div>

        <div
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          onClick={() => !uploading && fileInputRef.current?.click()}
          className={`
            relative cursor-pointer border-2 border-dashed rounded-xl p-10 flex flex-col items-center justify-center gap-3 transition-all
            ${dragging
              ? 'border-marine-cyan bg-marine-cyan/10 scale-[1.01]'
              : selectedFile
                ? 'border-emerald-500/50 bg-emerald-500/5'
                : 'border-zinc-200 dark:border-white/10 hover:border-marine-cyan/60 hover:bg-marine-cyan/5'
            }
          `}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx"
            className="hidden"
            onChange={e => handleFileSelect(e.target.files?.[0])}
          />
          {selectedFile ? (
            <>
              <FileSpreadsheet size={40} className="text-emerald-400" />
              <p className="font-semibold text-emerald-400 text-sm">{selectedFile.name}</p>
              <p className="text-xs text-zinc-400">{(selectedFile.size / 1024).toFixed(1)} KB · {t.clickToChange}</p>
            </>
          ) : (
            <>
              <div className={`p-4 rounded-2xl ${dragging ? 'bg-marine-cyan/20' : 'bg-zinc-100 dark:bg-white/5'} transition-colors`}>
                <Upload size={32} className={dragging ? 'text-marine-primary' : 'text-zinc-400'} />
              </div>
              <p className="font-semibold text-zinc-700 dark:text-zinc-200 text-sm">{t.dropHere}</p>
              <p className="text-xs text-zinc-400">{t.orBrowse}</p>
            </>
          )}
        </div>

        {error && (
          <div className="mt-3 flex items-start gap-2 text-sm bg-red-500/10 border border-red-500/30 text-red-300 rounded-lg px-4 py-3">
            <XCircle size={16} className="flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <button
          onClick={handleUpload}
          disabled={!selectedVendorId || !selectedFile || uploading}
          className="mt-4 w-full flex items-center justify-center gap-2 bg-marine-cyan hover:bg-marine-cyan-dark disabled:opacity-40 disabled:cursor-not-allowed text-white py-3 rounded-xl text-sm font-bold transition-colors"
        >
          {uploading
            ? <><Loader2 size={18} className="animate-spin" /> {t.processing}</>
            : <><Upload size={18} /> {t.uploadProcess}</>
          }
        </button>
      </div>

      {result && (
        <div className="bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/5 rounded-2xl p-5 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-4">
              <h2 className="font-bold text-zinc-900 dark:text-white">{t.results}</h2>
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1.5 text-sm font-semibold text-emerald-400">
                  <CheckCircle2 size={16} /> {result.succeeded.length} {t.succeeded}
                </span>
                <span className="text-zinc-600 dark:text-zinc-600">·</span>
                <span className="flex items-center gap-1.5 text-sm font-semibold text-red-400">
                  <XCircle size={16} /> {result.failed.length} {t.failed}
                </span>
                <span className="text-xs text-zinc-500">{t.of} {totalRows} {t.rowsWord}</span>
              </div>
            </div>
            {result.failed.length > 0 && (
              <button
                onClick={() => downloadErrorReport(result.failed)}
                className="flex items-center gap-2 border border-zinc-200 dark:border-white/10 hover:border-marine-cyan text-zinc-600 dark:text-zinc-300 hover:text-marine-primary px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
              >
                <Download size={14} /> {t.downloadErrorReport}
              </button>
            )}
          </div>

          {hasDrafts && (
            <div className="flex items-start gap-3 bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3">
              <AlertTriangle size={18} className="text-amber-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-amber-300">
                  {result.failed.filter(f => f.savedAsDraft).length} {t.draftBanner}
                </p>
                <p className="text-xs text-amber-400/70 mt-0.5">
                  {t.draftBannerBeforeAdmin} <button onClick={() => router.push('/admin/dashboard/products')} className="underline hover:text-amber-300">{t.productsList}</button> {t.draftBannerAfterAdmin}
                </p>
              </div>
            </div>
          )}

          {result.succeeded.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">{t.succeededLabel}</p>
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {result.succeeded.map((item) => <SuccessRow key={item._id} item={item} t={t} />)}
              </div>
            </div>
          )}

          {result.failed.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">{t.failedLabel}</p>
              <div className="space-y-2 max-h-[480px] overflow-y-auto pr-1">
                {result.failed.map((item) => <FailedRow key={`${item.row}-${item.sku}`} item={item} router={router} t={t} />)}
              </div>
            </div>
          )}

          <button
            onClick={() => { setResult(null); setError(null); }}
            className="w-full border border-zinc-200 dark:border-white/10 hover:border-marine-cyan/60 text-zinc-500 dark:text-zinc-400 hover:text-marine-primary py-2.5 rounded-xl text-sm font-semibold transition-colors"
          >
            {t.uploadAnother}
          </button>
        </div>
      )}
    </div>
  );
}