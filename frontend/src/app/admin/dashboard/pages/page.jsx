'use client';

import { useState, useEffect } from 'react';
import { Loader2, FileText, Edit2, X, Save } from 'lucide-react';
import { useApp } from '../../../../context/AppContext';
import { adminApi } from '../../../../lib/api';
import Overlay from '../../../../components/Overlay';

export default function AdminPages() {
  const { language } = useApp();
  const isAr = language === 'ar';
  
  const [pages, setPages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingPage, setEditingPage] = useState(null);
  const [error, setError] = useState('');

  const loadPages = async () => {
    setLoading(true);
    try {
      const data = await adminApi.getPages();
      setPages(data.pages || []);
      setError('');
    } catch (err) {
      setError(err.message || 'Failed to load pages');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPages();
  }, []);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-marine-primary" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col animate-in fade-in duration-300">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-black text-zinc-900 dark:text-white tracking-wide">
            {isAr ? 'إدارة الصفحات' : 'Pages Management'}
          </h1>
          <p className="text-sm text-zinc-500 mt-1">
            {isAr ? 'تعديل محتوى الصفحات الثابتة كالسياسات والشروط.' : 'Edit static page content such as policies and terms.'}
          </p>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 p-4 rounded-xl text-sm font-bold mb-6">
          {error}
        </div>
      )}

      <div className="bg-white dark:bg-[#14171A] rounded-xl shadow-sm border border-zinc-200 dark:border-white/5 overflow-hidden">
        {/* The scroll container is what makes the Action column reachable on a phone. The
            card above clips (`overflow-hidden`) to keep its rounded corners, so without
            this the last column is cut off with no way to scroll to it. */}
        <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-zinc-50 dark:bg-white/5 text-zinc-500 dark:text-zinc-400 font-bold">
            <tr>
              <th className="px-3 sm:px-6 py-4">{isAr ? 'العنوان' : 'Title'}</th>
              <th className="px-3 sm:px-6 py-4">{isAr ? 'الرابط' : 'Slug'}</th>
              <th className="px-3 sm:px-6 py-4 text-end">{isAr ? 'إجراء' : 'Action'}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-white/5">
            {pages.map(page => (
              <tr key={page._id} className="hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors">
                <td className="px-3 sm:px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-zinc-100 dark:bg-white/10 flex items-center justify-center text-zinc-500 dark:text-zinc-400">
                      <FileText size={18} />
                    </div>
                    <div>
                      <div className="font-bold text-zinc-900 dark:text-white">
                        {isAr ? page.title_ar : page.title_en}
                      </div>
                      <div className="text-xs text-zinc-500 mt-0.5">
                        {isAr ? page.title_en : page.title_ar}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-3 sm:px-6 py-4">
                  <span className="px-2.5 py-1 rounded-md bg-zinc-100 dark:bg-white/10 text-zinc-600 dark:text-zinc-400 text-xs font-mono">
                    /{page.slug}
                  </span>
                </td>
                <td className="px-3 sm:px-6 py-4 text-end">
                  <button
                    onClick={() => setEditingPage(page)}
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-100 hover:bg-marine-cyan text-zinc-600 hover:text-white transition-all duration-200 dark:bg-white/10 dark:text-zinc-300 dark:hover:bg-marine-cyan"
                  >
                    <Edit2 size={14} />
                    <span className="font-bold text-xs">{isAr ? 'تعديل' : 'Edit'}</span>
                  </button>
                </td>
              </tr>
            ))}
            {pages.length === 0 && (
              <tr>
                <td colSpan="3" className="px-6 py-12 text-center text-zinc-500 font-medium">
                  {isAr ? 'لا توجد صفحات. تأكد من تشغيل الباك إند ليتم توليدها تلقائياً.' : 'No pages found. Ensure the backend is running to auto-seed them.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </div>

      {editingPage && (
        <PageEditModal
          page={editingPage}
          onClose={() => setEditingPage(null)}
          onSaved={() => {
            setEditingPage(null);
            loadPages();
          }}
        />
      )}
    </div>
  );
}

function PageEditModal({ page, onClose, onSaved }) {
  const { language } = useApp();
  const isAr = language === 'ar';
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  
  const [form, setForm] = useState({
    title_en: page.title_en || '',
    title_ar: page.title_ar || '',
    content_en: page.content_en || '',
    content_ar: page.content_ar || '',
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await adminApi.updatePage(page._id, form);
      onSaved();
    } catch (err) {
      setError(err.message || 'Failed to update page');
    } finally {
      setSaving(false);
    }
  };

  const inputClass = "w-full bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm focus:border-marine-cyan focus:outline-none dark:text-white transition-colors";

  return (
    <Overlay className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-5xl max-h-[90vh] flex flex-col bg-white dark:bg-[#14171A] rounded-2xl border border-zinc-200 dark:border-white/10 shadow-2xl overflow-hidden">
        
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-zinc-100 dark:border-white/5 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-red-50 dark:bg-marine-cyan/10 text-marine-primary flex items-center justify-center">
              <FileText size={22} />
            </div>
            <div>
              <h2 className="text-lg font-black text-zinc-900 dark:text-white">
                {isAr ? 'تعديل الصفحة' : 'Edit Page'}
              </h2>
              <p className="text-xs text-zinc-500 mt-1 font-mono">
                /{page.slug}
              </p>
            </div>
          </div>
          <button 
            onClick={onClose} 
            className="p-2 text-zinc-400 hover:text-zinc-900 dark:hover:text-white rounded-xl hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto flex-1 custom-scrollbar">
          {error && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 p-3 rounded-xl text-sm font-bold mb-5">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* English Section */}
            <div className="space-y-4">
              <h3 className="font-bold text-zinc-900 dark:text-white text-base border-b border-zinc-100 dark:border-white/5 pb-2">
                English Content
              </h3>
              <label className="block">
                <span className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">Title</span>
                <input
                  type="text"
                  required
                  value={form.title_en}
                  onChange={e => setForm({ ...form, title_en: e.target.value })}
                  className={inputClass}
                  dir="ltr"
                />
              </label>
              <label className="block">
                <span className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2 flex justify-between">
                  <span>Content</span>
                  <span className="font-normal text-zinc-400 lowercase normal-case">Preserves line breaks</span>
                </span>
                <textarea
                  required
                  rows={20}
                  value={form.content_en}
                  onChange={e => setForm({ ...form, content_en: e.target.value })}
                  className={`${inputClass} resize-y whitespace-pre-wrap`}
                  dir="ltr"
                />
              </label>
            </div>

            {/* Arabic Section */}
            <div className="space-y-4">
              <h3 className="font-bold text-zinc-900 dark:text-white text-base border-b border-zinc-100 dark:border-white/5 pb-2" dir="rtl">
                المحتوى العربي
              </h3>
              <label className="block text-right">
                <span className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">العنوان</span>
                <input
                  type="text"
                  required
                  value={form.title_ar}
                  onChange={e => setForm({ ...form, title_ar: e.target.value })}
                  className={inputClass}
                  dir="rtl"
                />
              </label>
              <label className="block text-right">
                <span className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2 flex justify-between flex-row-reverse">
                  <span>المحتوى</span>
                  <span className="font-normal text-zinc-400 lowercase normal-case">يحافظ على الأسطر</span>
                </span>
                <textarea
                  required
                  rows={20}
                  value={form.content_ar}
                  onChange={e => setForm({ ...form, content_ar: e.target.value })}
                  className={`${inputClass} resize-y whitespace-pre-wrap`}
                  dir="rtl"
                />
              </label>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-5 border-t border-zinc-100 dark:border-white/5 flex justify-end gap-3 shrink-0">
          <button 
            type="button" 
            onClick={onClose} 
            className="px-5 py-2.5 rounded-xl border border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-300 font-bold hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors"
          >
            {isAr ? 'إلغاء' : 'Cancel'}
          </button>
          <button 
            type="button" 
            onClick={handleSubmit}
            disabled={saving} 
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-marine-cyan hover:bg-marine-cyan-dark disabled:opacity-50 text-white rounded-xl font-bold transition-colors"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            {isAr ? 'حفظ التغييرات' : 'Save Changes'}
          </button>
        </div>

      </div>
    </Overlay>
  );
}
