'use client';

import { useState, useRef, useCallback } from 'react';
import { useRouter } from '../../../../lib/navigation';
import { vendorApi, downloadFile } from '../../../../lib/api';
import { useApp } from '../../../../context/AppContext';
import {
  Upload, Download, FileSpreadsheet, CheckCircle2, XCircle,
  AlertTriangle, ArrowLeft, ChevronDown, ChevronUp, Loader2,
  ExternalLink, FileX, Table2
} from 'lucide-react';
import { localizeBulkError } from '../../../../lib/dashboardLocalization';
import ReviewLinksPanel from '../../../../components/dashboard/catalog/ReviewLinksPanel';

/* ── tiny client-side XLSX writer for error report ─────────────────── */
async function downloadErrorReport(failedRows, language) {
  // Dynamic import so xlsx is not bundled unless needed
  const XLSX = (await import('xlsx')).default || (await import('xlsx'));

  const wsData = [
    language === 'ar'
      ? ['الصف', 'رمز المنتج', 'العنوان', 'حُفظ كمسودة؟', 'معرّف المسودة', 'الأخطاء']
      : ['Row', 'SKU', 'Title', 'Saved as Draft?', 'Draft ID', 'Errors'],
  ];
  for (const row of failedRows) {
    const errors = row.errors.map((error) => localizeBulkError(error, language));
    wsData.push([
      row.row,
      row.sku || '',
      row.title || '',
      row.savedAsDraft ? (language === 'ar' ? 'نعم' : 'YES') : (language === 'ar' ? 'لا' : 'NO'),
      row.draftId || '',
      errors.map(e => `[${e.field}] ${e.message}`).join(' | '),
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(wsData);
  // Auto column widths
  ws['!cols'] = [{ wch: 6 }, { wch: 20 }, { wch: 30 }, { wch: 16 }, { wch: 28 }, { wch: 80 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, language === 'ar' ? 'الأخطاء' : 'Errors');
  XLSX.writeFile(wb, language === 'ar' ? 'اخطاء_رفع_المنتجات.xlsx' : 'bulk_upload_errors.xlsx');
}

/* ── Row result card ─────────────────────────────────────────────────── */
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

function FailedRow({ item, router, t, language }) {
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
          {item.errors.map((err, i) => {
            const localizedError = localizeBulkError(err, language);
            return (
            <div key={i} className="flex gap-2 text-sm">
              <span className="font-mono text-xs bg-red-500/20 text-red-300 px-1.5 py-0.5 rounded flex-shrink-0">{localizedError.field}</span>
              <span className="text-zinc-300">{localizedError.message}</span>
            </div>
          )})}
          {item.savedAsDraft && item.draftId && (
            <button
              onClick={() => router.push(`/dashboard/products/${item.draftId}/edit`)}
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

/* ── Main Page ───────────────────────────────────────────────────────── */
export default function BulkUploadPage() {
  const router = useRouter();
  const fileInputRef = useRef(null);
  const { t: tAll, language } = useApp();
  const t = tAll.bulk;

  const [dragging, setDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null); // { succeeded, failed }
  const [error, setError] = useState(null);
  // The parsed file plus a proposed catalog entry per row. Held between upload
  // and save: nothing is written until the vendor has been through the links.
  const [preview, setPreview] = useState(null);
  const [saving, setSaving] = useState(false);

  /* ── File validation (client-side pre-check) ── */
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

  /* ── Drag & Drop ── */
  const onDragOver = useCallback((e) => { e.preventDefault(); setDragging(true); }, []);
  const onDragLeave = useCallback(() => setDragging(false), []);
  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFileSelect(file);
  }, []);

  /* ── Upload → review links (nothing is saved yet) ── */
  const handleUpload = async () => {
    if (!selectedFile) return;
    setUploading(true);
    setError(null);
    setResult(null);
    try {
      const data = await vendorApi.previewBulkUpload(selectedFile);
      setPreview(data);
      setSelectedFile(null);
    } catch (err) {
      setError(language === 'ar' ? (t.uploadFailed || 'تعذر رفع الملف.') : (err.message || t.uploadFailed));
    } finally {
      setUploading(false);
    }
  };

  /* ── Save the reviewed rows ──
     Same per-row success/failure handling as before — the review step changes
     what each row is linked to, not how saving reports itself. */
  const handleSaveReviewed = async (rows) => {
    setSaving(true);
    setError(null);
    try {
      const data = await vendorApi.saveReviewedBulkUpload(rows);
      setResult(data);
      setPreview(null);
    } catch (err) {
      setError(language === 'ar' ? (t.uploadFailed || 'تعذر حفظ المنتجات.') : (err.message || t.uploadFailed));
    } finally {
      setSaving(false);
    }
  };

  /* ── Template download ── */
  // Opened as a link so the browser saves it itself — see downloadFile.
  const handleDownloadTemplate = () => downloadFile(vendorApi.bulkTemplateUrl(language));

  const totalRows = (result?.succeeded?.length ?? 0) + (result?.failed?.length ?? 0);
  const hasDrafts = result?.failed?.some(f => f.savedAsDraft);

  return (
    <div className="h-full flex flex-col animate-in fade-in duration-300 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-6 flex-wrap">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push('/dashboard/products')}
            className="p-2 rounded-lg hover:bg-white/5 transition-colors text-zinc-400 hover:text-white"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-white tracking-tight">{t.title}</h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">{t.subtitle}</p>
          </div>
        </div>
        <button
          onClick={() => router.push('/dashboard/products/bulk-entry')}
          className="flex items-center gap-2 text-sm font-semibold text-zinc-600 dark:text-zinc-300 border border-zinc-200 dark:border-white/10 hover:border-marine-cyan hover:text-marine-primary px-3 py-2 rounded-lg transition-colors"
        >
          <Table2 size={15} /> {language === 'ar' ? 'جرّب الرفع الجماعي أونلاين' : 'Prefer a guided table? Bulk Online Upload'}
        </button>
      </div>

      {/* Review links — sits between the upload and the save, so the catalog
          match is a decision the vendor made rather than one made for them. */}
      {preview && (
        <div className="mb-4">
          <ReviewLinksPanel
            language={language}
            preview={preview}
            saving={saving}
            onCancel={() => { setPreview(null); setError(null); }}
            onSave={handleSaveReviewed}
          />
          {error && (
            <div className="mt-3 flex items-start gap-2 text-sm bg-red-500/10 border border-red-500/30 text-red-500 rounded-lg px-4 py-3">
              <XCircle size={16} className="flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
        </div>
      )}

      {/* Step 1: Download Template */}
      <div className={`bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/5 rounded-2xl p-5 mb-4 ${preview ? 'hidden' : ''}`}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-marine-cyan text-white text-sm font-bold flex items-center justify-center flex-shrink-0">1</div>
            <div>
              <p className="font-semibold text-zinc-900 dark:text-white text-sm">{t.step1Title}</p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">{t.step1Desc}</p>
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
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[t.tipXlsxOnly, t.tipMaxRows, t.tipDataRow6, t.tipSlugs].map(tip => (
            <div key={tip} className="bg-zinc-50 dark:bg-white/5 rounded-lg px-3 py-2 text-xs text-zinc-500 dark:text-zinc-400 text-center">{tip}</div>
          ))}
        </div>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-3">{t.shippingNote}</p>
      </div>

      {/* Step 2: Upload File */}
      <div className={`bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/5 rounded-2xl p-5 mb-4 ${preview ? 'hidden' : ''}`}>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-8 h-8 rounded-full bg-marine-cyan text-white text-sm font-bold flex items-center justify-center flex-shrink-0">2</div>
          <div>
            <p className="font-semibold text-zinc-900 dark:text-white text-sm">{t.step2Title}</p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">{t.step2Desc}</p>
          </div>
        </div>

        {/* Drop zone */}
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

        {/* Error message */}
        {error && (
          <div className="mt-3 flex items-start gap-2 text-sm bg-red-500/10 border border-red-500/30 text-red-300 rounded-lg px-4 py-3">
            <XCircle size={16} className="flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Upload button */}
        <button
          onClick={handleUpload}
          disabled={!selectedFile || uploading}
          className="mt-4 w-full flex items-center justify-center gap-2 bg-marine-cyan hover:bg-marine-cyan-dark disabled:opacity-40 disabled:cursor-not-allowed text-white py-3 rounded-xl text-sm font-bold transition-colors"
        >
          {uploading
            ? <><Loader2 size={18} className="animate-spin" /> {t.processing}</>
            : <><Upload size={18} /> {language === 'ar' ? 'رفع ومراجعة' : 'Upload & review'}</>
          }
        </button>
      </div>

      {/* Results */}
      {result && (
        <div className="bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/5 rounded-2xl p-5 space-y-5">
          {/* Summary bar */}
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
                onClick={() => downloadErrorReport(result.failed, language)}
                className="flex items-center gap-2 border border-zinc-200 dark:border-white/10 hover:border-marine-cyan text-zinc-600 dark:text-zinc-300 hover:text-marine-primary px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
              >
                <Download size={14} /> {t.downloadErrorReport}
              </button>
            )}
          </div>

          {/* Draft banner */}
          {hasDrafts && (
            <div className="flex items-start gap-3 bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3">
              <AlertTriangle size={18} className="text-amber-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-amber-300">
                  {result.failed.filter(f => f.savedAsDraft).length} {t.draftBanner}
                </p>
                <p className="text-xs text-amber-400/70 mt-0.5">
                  {t.draftBannerBeforeVendor} <button onClick={() => router.push('/dashboard/products')} className="underline hover:text-amber-300">{t.productsList}</button> {t.draftBannerAfterVendor}
                </p>
              </div>
            </div>
          )}

          {/* Succeeded rows */}
          {result.succeeded.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">{t.succeededLabel}</p>
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {result.succeeded.map((item) => (
                  <SuccessRow key={item._id} item={item} t={t} />
                ))}
              </div>
            </div>
          )}

          {/* Failed rows */}
          {result.failed.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">{t.failedLabel}</p>
              <div className="space-y-2 max-h-[480px] overflow-y-auto pr-1">
                {result.failed.map((item) => (
                  <FailedRow key={`${item.row}-${item.sku}`} item={item} router={router} t={t} language={language} />
                ))}
              </div>
            </div>
          )}

          {/* Upload another */}
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
